import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CashRegistersService } from './cash-registers.service';
import { PrismaService } from '../../database/prisma/prisma.service';

// ─── Constants ────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-001';
const USER_ID = 'user-uuid-001';
const REGISTER_ID = 'reg-uuid-001';
const SESSION_ID = 'session-uuid-001';

function createMockPrisma() {
  const tx = {
    cashRegisterMovement: { create: jest.fn().mockResolvedValue({ id: 'mov-1' }) },
    financialAccount: { update: jest.fn().mockResolvedValue({ balance: 1000 }) },
    financialTransaction: { create: jest.fn().mockResolvedValue({ id: 'trx-1' }) },
    cashRegisterSession: { create: jest.fn(), update: jest.fn() },
  };
  return {
    tx,
    cashRegister: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    // A conta vinculada é a gaveta: a abertura compara o declarado com o que
    // ela já acusa, e o fechamento transfere o excedente para outra conta.
    financialAccount: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'acc-1',
        name: 'Caixa 01',
        balance: 0,
      }),
    },
    cashRegisterSession: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    cashRegisterMovement: {
      create: jest.fn(),
    },
    orderPayment: {
      aggregate: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
}

/** O `data` de cada chamada a um mock do Prisma, tipado para as asserções. */
function allCallData(mock: jest.Mock): Record<string, unknown>[] {
  return (mock.mock.calls as [{ data: Record<string, unknown> }][]).map(([arg]) => arg.data);
}

describe('CashRegistersService', () => {
  let service: CashRegistersService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashRegistersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CashRegistersService>(CashRegistersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── FN-06: sangria não pode passar do saldo do caixa ────────────────────

  describe('withdraw (FN-06)', () => {
    // The QA drained a register to −R$ 4.999.300,00 and the closing screen
    // reported a "difference" of R$ 5.000.300,00 painted green, as if the
    // drawer had a surplus. A drawer cannot hold negative cash.
    beforeEach(() => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
        isActive: true,
      });
      prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-cofre', name: 'Cofre' });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 100,
        movements: [
          { type: 'SUPPLY', amount: 50 },
          { type: 'WITHDRAW', amount: 20 },
        ],
      });
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 30 } });
    });

    it('allows a withdrawal up to the available balance', async () => {
      // 100 opening + 50 supply - 20 withdrawn + 30 cash sales = 160
      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 160,
          reason: 'Sangria para o cofre',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a withdrawal larger than the available balance', async () => {
      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 160.01,
          reason: 'Sangria absurda',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('says how much is actually available', async () => {
      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 5000,
          reason: 'Sangria absurda',
        }),
      ).rejects.toThrow(/160/);
    });

    it('counts cash sales of the session as available money', async () => {
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });

      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 1000,
          reason: 'Sangria do dia',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a zero or negative withdrawal', async () => {
      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, { amount: 0, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── FN-15: o caixa físico tem que refletir na conta financeira ──────────

  describe('cash movements reach the linked account (FN-15)', () => {
    // openSession/supply/withdraw/closeSession never touched FinancialAccount,
    // so the linked account stayed at R$ 0,00 through a whole day of sales,
    // supplies and sangrias — there was nothing to reconcile against.
    beforeEach(() => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        isActive: true,
      });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 100,
        movements: [],
      });
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.tx.cashRegisterSession.create.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 100,
      });
    });

    it('credits the account when the drawer receives a supply', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue({
        id: 'acc-cofre',
        name: 'Cofre',
        type: 'CASH',
        balance: 1000,
      });

      await service.supply(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 200,
        reason: 'Troco',
        sourceAccountId: 'acc-cofre',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: 200 } },
        select: { balance: true },
      });
      const credit = allCallData(prisma.tx.financialTransaction.create).find((t) => t.type === 'CREDIT');
      expect(credit).toMatchObject({ accountId: 'acc-1', amount: 200, referenceType: 'transfer' });
    });

    it('debits the account when money leaves the drawer', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-cofre', name: 'Cofre' });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 500,
        movements: [],
      });

      await service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 200,
        reason: 'Sangria',
        destinationAccountId: 'acc-cofre',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { decrement: 200 } },
        select: { balance: true },
      });
      const trx = prisma.tx.financialTransaction.create.mock.calls[0][0].data;
      expect(trx).toMatchObject({ type: 'DEBIT', amount: 200 });
    });

    it('books the opening float when the session opens', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      prisma.financialAccount.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'acc-cofre'
            ? { id: 'acc-cofre', name: 'Cofre', type: 'CASH', balance: 500 }
            : { id: 'acc-1', name: 'Caixa 01', balance: 0 },
        ),
      );

      await service.openSession(TENANT_ID, REGISTER_ID, USER_ID, {
        openingBalance: 100,
        sourceAccountId: 'acc-cofre',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: 100 } },
        select: { balance: true },
      });
    });

    it('does not book anything when the session opens empty', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      prisma.tx.cashRegisterSession.create.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 0,
      });

      await service.openSession(TENANT_ID, REGISTER_ID, USER_ID, {
        openingBalance: 0,
      });

      expect(prisma.tx.financialAccount.update).not.toHaveBeenCalled();
    });

    it('books the counted difference when the session closes short', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 100,
        movements: [],
      });
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.tx.cashRegisterSession.update.mockResolvedValue({ id: SESSION_ID });

      // Expected 100, counted 90 — R$ 10 short. The account has to know.
      await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 90,
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { decrement: 10 } },
        select: { balance: true },
      });
    });

    it('books nothing on a session that closes exactly', async () => {
      prisma.tx.cashRegisterSession.update.mockResolvedValue({ id: SESSION_ID });

      await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 100,
      });

      expect(prisma.tx.financialAccount.update).not.toHaveBeenCalled();
    });

  });

  // ─── A tela do caixa e o fechamento têm que contar a mesma coisa ─────────

  describe('getCurrentSession totals', () => {
    // A conciliação de um dia inteiro pegou isto: a tela mostrava "saldo atual
    // R$ 100" e o fechamento esperava R$ 249,90 — a tela não somava as vendas
    // em dinheiro da sessão. O operador conferia a gaveta contra o número
    // errado e o caixa "fechava" com diferença.
    beforeEach(() => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
      });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 200,
        movements: [
          { type: 'SUPPLY', amount: 50 },
          { type: 'WITHDRAW', amount: 100 },
        ],
      });
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 149.9 } });
    });

    /** A sessão aberta sempre tem totais; o `null` é o caso "sem sessão". */
    async function openTotals() {
      const result = await service.getCurrentSession(TENANT_ID, REGISTER_ID);
      if (!('totals' in result)) throw new Error('expected an open session');
      return result.totals;
    }

    it('includes the cash sales of the session in the running balance', async () => {
      const totals = await openTotals();

      // 200 + 50 - 100 + 149.90
      expect(totals.currentBalance).toBe(299.9);
    });

    it('reports the cash sales as their own figure', async () => {
      const totals = await openTotals();

      expect(totals.cashSales).toBe(149.9);
      expect(totals.supplies).toBe(50);
      expect(totals.withdrawals).toBe(100);
    });

    it('agrees with what closeSession will expect', async () => {
      const totals = await openTotals();
      prisma.tx.cashRegisterSession.update.mockResolvedValue({ id: SESSION_ID });

      await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: totals.currentBalance,
      });

      const data = prisma.tx.cashRegisterSession.update.mock.calls[0][0].data;
      expect(data.expectedBalance).toBe(totals.currentBalance);
      expect(data.difference).toBe(0);
    });
  });

  // ─── findAllSessions — least privilege for the seller (VD-07) ─────────────

  describe('findAllSessions', () => {
    beforeEach(() => {
      prisma.cashRegisterSession.findMany.mockResolvedValue([]);
      prisma.cashRegisterSession.count.mockResolvedValue(0);
    });

    function whereOfLastQuery() {
      return prisma.cashRegisterSession.findMany.mock.calls[0][0].where;
    }

    it('returns every session for a caller who can read the financial module', async () => {
      await service.findAllSessions(TENANT_ID, {}, { openSessionsOnly: false });

      expect(whereOfLastQuery()).toEqual({ tenantId: TENANT_ID });
    });

    it('returns only open sessions when the caller only has cash-registers:read-session', async () => {
      await service.findAllSessions(TENANT_ID, {}, { openSessionsOnly: true });

      expect(whereOfLastQuery()).toEqual({ tenantId: TENANT_ID, status: 'OPEN' });
    });

    it('ignores a CLOSED filter from a caller restricted to open sessions', async () => {
      await service.findAllSessions(
        TENANT_ID,
        { status: 'CLOSED' },
        { openSessionsOnly: true },
      );

      expect(whereOfLastQuery()).toEqual({ tenantId: TENANT_ID, status: 'OPEN' });
    });

    it('defaults to the unrestricted listing when no scope is given', async () => {
      await service.findAllSessions(TENANT_ID, {});

      expect(whereOfLastQuery()).toEqual({ tenantId: TENANT_ID });
    });

    it('keeps scoping every query by tenant', async () => {
      await service.findAllSessions(TENANT_ID, { cashRegisterId: REGISTER_ID });

      expect(whereOfLastQuery()).toEqual({
        tenantId: TENANT_ID,
        cashRegisterId: REGISTER_ID,
      });
    });
  });

  // ─── closeSession — expectedBalance including cash sales (SCRUM-29) ────────

  describe('closeSession', () => {
    beforeEach(() => {
      prisma.cashRegister.findFirst.mockResolvedValue({ id: REGISTER_ID, name: 'Caixa 01' });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 100,
        movements: [
          { type: 'SUPPLY', amount: 50 },
          { type: 'WITHDRAW', amount: 20 },
        ],
      });
      // Echo the update data so we can assert on expectedBalance/difference
      prisma.cashRegisterSession.update.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({ id: SESSION_ID, ...data }),
      );
    });

    it('should add cash sales of the session to the expected balance', async () => {
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 200 } });

      await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 335,
      } as never);

      const data = prisma.tx.cashRegisterSession.update.mock.calls[0][0].data;
      // 100 (opening) + 50 (supply) - 20 (withdraw) + 200 (cash sales) = 330
      expect(data.expectedBalance).toBe(330);
      // Counted 335 => positive difference (surplus) of 5
      expect(data.difference).toBe(5);
    });

    it('should sum only CASH payments of orders linked to this session, scoped by tenant', async () => {
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 130,
      } as never);

      const where = prisma.orderPayment.aggregate.mock.calls[0][0].where;
      expect(where.tenantId).toBe(TENANT_ID);
      expect(where.paymentMethod).toEqual({ type: 'CASH' });
      expect(where.order).toEqual({ cashRegisterSessionId: SESSION_ID });
    });

    it('should fall back to opening + supplies - withdrawals when there are no cash sales', async () => {
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });

      await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 130,
      } as never);

      const data = prisma.tx.cashRegisterSession.update.mock.calls[0][0].data;
      // 100 + 50 - 20 + 0 = 130 => difference 0
      expect(data.expectedBalance).toBe(130);
      expect(data.difference).toBe(0);
    });

    it('should throw when there is no open session for the register', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);

      await expect(
        service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, { closingBalance: 100 } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Saldo atual na listagem de caixas ──────────────────────────────────

  describe('findAll — saldo corrente da sessão aberta', () => {
    // O card da tela de caixa mostrava só o saldo de abertura: abertura de
    // R$ 50,00, uma venda de R$ 349,90 em dinheiro e a tela seguia em R$ 50,00
    // enquanto a gaveta (e o fechamento) contavam R$ 399,90.
    beforeEach(() => {
      prisma.cashRegister.findMany.mockResolvedValue([
        {
          id: REGISTER_ID,
          name: 'Caixa principal',
          sessions: [
            {
              id: SESSION_ID,
              status: 'OPEN',
              openingBalance: 50,
              movements: [],
            },
          ],
        },
      ]);
      prisma.cashRegister.count.mockResolvedValue(1);
    });

    it('soma as vendas em dinheiro da sessão ao saldo de abertura', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        { amount: 349.9, order: { cashRegisterSessionId: SESSION_ID } },
      ]);

      const result = await service.findAll(TENANT_ID, {});
      const [register] = result.data as {
        sessions: { totals: { cashSales: number; currentBalance: number } }[];
      }[];

      expect(register.sessions[0].totals.cashSales).toBe(349.9);
      expect(register.sessions[0].totals.currentBalance).toBe(399.9);
    });

    it('desconta sangrias e soma suprimentos', async () => {
      prisma.cashRegister.findMany.mockResolvedValue([
        {
          id: REGISTER_ID,
          name: 'Caixa principal',
          sessions: [
            {
              id: SESSION_ID,
              status: 'OPEN',
              openingBalance: 50,
              movements: [
                { type: 'SUPPLY', amount: 100 },
                { type: 'WITHDRAW', amount: 30 },
              ],
            },
          ],
        },
      ]);
      prisma.orderPayment.findMany.mockResolvedValue([]);

      const result = await service.findAll(TENANT_ID, {});
      const [register] = result.data as {
        sessions: { totals: { currentBalance: number } }[];
      }[];

      expect(register.sessions[0].totals.currentBalance).toBe(120);
    });

    it('não expõe as movimentações na listagem — só os totais', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([]);

      const result = await service.findAll(TENANT_ID, {});
      const [register] = result.data as { sessions: Record<string, unknown>[] }[];

      expect(register.sessions[0]).not.toHaveProperty('movements');
    });

    it('não consulta pagamentos quando nenhum caixa está aberto', async () => {
      prisma.cashRegister.findMany.mockResolvedValue([
        { id: REGISTER_ID, name: 'Caixa principal', sessions: [] },
      ]);

      await service.findAll(TENANT_ID, {});

      expect(prisma.orderPayment.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── Abrir caixa não cria dinheiro ──────────────────────────────────────

  describe('openSession — o fundo de troco que falta vem do cofre', () => {
    // O fundo de troco que dormiu na gaveta já está na conta: não se credita de
    // novo. O que o operador declara acima disso é dinheiro que entrou na gaveta
    // — e ele saiu de algum lugar. Antes a abertura creditava essa diferença do
    // nada, o mesmo erro que o suprimento cometia.
    const cofre = { id: 'acc-cofre', name: 'Cofre', type: 'CASH', balance: 500 };
    const banco = { id: 'acc-banco', name: 'Santander', type: 'CHECKING', balance: 0 };
    let drawerBalance = 50;

    beforeEach(() => {
      drawerBalance = 50;
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
        isActive: true,
      });
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      prisma.tx.cashRegisterSession.create.mockResolvedValue({ id: SESSION_ID });
      prisma.financialAccount.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'acc-1'
            ? { id: 'acc-1', name: 'Caixa 01', balance: drawerBalance }
            : ([cofre, banco].find((a) => a.id === where.id) ?? null),
        ),
      );
    });

    it('não move nada quando o fundo declarado já está na conta', async () => {
      await service.openSession(TENANT_ID, REGISTER_ID, USER_ID, { openingBalance: 50 });

      expect(prisma.tx.financialAccount.update).not.toHaveBeenCalled();
    });

    it('não exige cofre quando nada precisa entrar na gaveta', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: null,
        isActive: true,
      });

      await expect(
        service.openSession(TENANT_ID, REGISTER_ID, USER_ID, { openingBalance: 50 }),
      ).resolves.toBeDefined();
    });

    it('traz do cofre só o que falta para o fundo declarado', async () => {
      await service.openSession(TENANT_ID, REGISTER_ID, USER_ID, { openingBalance: 120 });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-cofre' },
        data: { balance: { decrement: 70 } },
        select: { balance: true },
      });
      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: 70 } },
        select: { balance: true },
      });
      expect(allCallData(prisma.tx.financialTransaction.create)).toEqual([
        expect.objectContaining({ accountId: 'acc-cofre', type: 'DEBIT', amount: 70, referenceType: 'transfer' }),
        expect.objectContaining({ accountId: 'acc-1', type: 'CREDIT', amount: 70, referenceType: 'transfer' }),
      ]);
    });

    it('a conta escolhida na abertura vale mais que o cofre do caixa', async () => {
      await service.openSession(TENANT_ID, REGISTER_ID, USER_ID, {
        openingBalance: 120,
        sourceAccountId: 'acc-banco',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-banco' }, data: { balance: { decrement: 70 } } }),
      );
      expect(prisma.tx.financialAccount.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-cofre' } }),
      );
    });

    it('recusa abrir com dinheiro a mais sem dizer de onde ele vem', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: null,
        isActive: true,
      });

      const attempt = service.openSession(TENANT_ID, REGISTER_ID, USER_ID, { openingBalance: 120 });

      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow(/R\$\s70,00/);
      await expect(attempt).rejects.toThrow(/conta de origem/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa tirar do cofre mais do que ele tem', async () => {
      const attempt = service.openSession(TENANT_ID, REGISTER_ID, USER_ID, { openingBalance: 600 });

      await expect(attempt).rejects.toThrow(/Saldo insuficiente em "Cofre"/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa usar a própria gaveta como origem do fundo', async () => {
      await expect(
        service.openSession(TENANT_ID, REGISTER_ID, USER_ID, {
          openingBalance: 120,
          sourceAccountId: 'acc-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa abrir com menos do que a conta acusa — dinheiro saiu sem registro', async () => {
      drawerBalance = 399.9;

      await expect(
        service.openSession(TENANT_ID, REGISTER_ID, USER_ID, { openingBalance: 50 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── Fechamento leva o dinheiro do dia para o destino ───────────────────

  // ─── Sangria é transferência: o dinheiro muda de lugar, não some ─────────

  describe('withdraw — sangria transfere para a conta de destino', () => {
    // A sangria só debitava a conta da gaveta. Os R$ 500 levados ao cofre
    // saíam do caixa e não entravam em lugar nenhum: o patrimônio da empresa
    // caía sem despesa que explicasse, e um sumiço entre a gaveta e o cofre
    // não aparecia em conferência nenhuma.
    const cofre = { id: 'acc-cofre', name: 'Cofre' };
    const banco = { id: 'acc-banco', name: 'Santander' };

    beforeEach(() => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: null,
        isActive: true,
      });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 1000,
        movements: [],
      });
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.financialAccount.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve([cofre, banco].find((a) => a.id === where.id) ?? null),
      );
    });

    it('debita a gaveta e credita a conta de destino', async () => {
      await service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 500,
        reason: 'Excesso na gaveta',
        destinationAccountId: 'acc-cofre',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { decrement: 500 } },
        select: { balance: true },
      });
      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-cofre' },
        data: { balance: { increment: 500 } },
        select: { balance: true },
      });
      const trxs = allCallData(prisma.tx.financialTransaction.create);
      expect(trxs).toEqual([
        expect.objectContaining({ accountId: 'acc-1', type: 'DEBIT', amount: 500, referenceType: 'transfer' }),
        expect.objectContaining({ accountId: 'acc-cofre', type: 'CREDIT', amount: 500, referenceType: 'transfer' }),
      ]);
    });

    it('grava no movimento da gaveta para onde o dinheiro foi e qual transferência o levou', async () => {
      await service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 500,
        reason: 'Excesso na gaveta',
        destinationAccountId: 'acc-cofre',
      });

      const movement = allCallData(prisma.tx.cashRegisterMovement.create)[0];
      const debit = allCallData(prisma.tx.financialTransaction.create)[0];
      expect(movement).toMatchObject({
        type: 'WITHDRAW',
        amount: 500,
        counterpartAccountId: 'acc-cofre',
        transferId: debit.referenceId,
      });
      expect(movement.transferId).toEqual(expect.any(String));
    });

    it('usa a conta padrão do caixa quando o operador não escolhe outra', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
        isActive: true,
      });

      await service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, { amount: 100, reason: 'Sangria' });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-cofre' }, data: { balance: { increment: 100 } } }),
      );
    });

    it('a conta escolhida na sangria vale mais que a padrão do caixa', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
        isActive: true,
      });

      await service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 100,
        reason: 'Depósito direto',
        destinationAccountId: 'acc-banco',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-banco' }, data: { balance: { increment: 100 } } }),
      );
      expect(prisma.tx.financialAccount.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-cofre' } }),
      );
    });

    it('recusa sangria sem destino e aponta o caminho da despesa', async () => {
      const attempt = service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 100,
        reason: 'Motoboy',
      });

      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow(/conta de destino/);
      await expect(attempt).rejects.toThrow(/despesa/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa mandar a sangria para a conta do próprio caixa', async () => {
      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 100,
          reason: 'Sangria',
          destinationAccountId: 'acc-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('procura a conta de destino só na empresa do token, ativa e não excluída', async () => {
      await service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 100,
        reason: 'Sangria',
        destinationAccountId: 'acc-cofre',
      });

      expect(prisma.financialAccount.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acc-cofre', tenantId: TENANT_ID, isActive: true, deletedAt: null },
        }),
      );
    });

    it('recusa conta de destino de outra empresa, inativa ou excluída', async () => {
      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 100,
          reason: 'Sangria',
          destinationAccountId: 'acc-de-outra-empresa',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('não move dinheiro nenhum quando falta saldo na gaveta', async () => {
      await expect(
        service.withdraw(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 1000.01,
          reason: 'Sangria',
          destinationAccountId: 'acc-cofre',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── Conta padrão da sangria no cadastro do caixa ─────────────────────────

  describe('conta padrão da sangria (create/update)', () => {
    const cofre = { id: 'acc-cofre', name: 'Cofre' };
    const gaveta = { id: 'acc-1', name: 'Caixa 01' };

    beforeEach(() => {
      prisma.financialAccount.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve([cofre, gaveta].find((a) => a.id === where.id) ?? null),
      );
      prisma.cashRegister.findUnique.mockResolvedValue(null);
      prisma.cashRegister.create.mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data));
      prisma.cashRegister.update.mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data));
    });

    it('cadastra o caixa já com a conta padrão da sangria', async () => {
      await service.create(TENANT_ID, {
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
      });

      expect(allCallData(prisma.cashRegister.create)[0]).toMatchObject({
        vaultAccountId: 'acc-cofre',
      });
    });

    it('recusa a conta do próprio caixa como destino padrão', async () => {
      await expect(
        service.create(TENANT_ID, {
          name: 'Caixa 01',
          financialAccountId: 'acc-1',
          vaultAccountId: 'acc-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cashRegister.create).not.toHaveBeenCalled();
    });

    it('recusa conta padrão que não é da empresa', async () => {
      await expect(
        service.create(TENANT_ID, {
          name: 'Caixa 01',
          financialAccountId: 'acc-1',
          vaultAccountId: 'acc-de-outra-empresa',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('troca a conta padrão de um caixa existente', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: null,
      });

      await service.update(TENANT_ID, REGISTER_ID, { vaultAccountId: 'acc-cofre' });

      expect(allCallData(prisma.cashRegister.update)[0]).toMatchObject({
        vaultAccountId: 'acc-cofre',
      });
    });

    it('remove a conta padrão quando recebe null', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
      });

      await service.update(TENANT_ID, REGISTER_ID, { vaultAccountId: null });

      expect(allCallData(prisma.cashRegister.update)[0]).toMatchObject({
        vaultAccountId: null,
      });
    });

    it('recusa trocar a conta do caixa para a que já é o destino da sangria', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
      });

      await expect(
        service.update(TENANT_ID, REGISTER_ID, { financialAccountId: 'acc-cofre' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Suprimento é transferência: o dinheiro vem de algum lugar ───────────

  describe('supply — suprimento transfere da conta de origem', () => {
    // O suprimento só creditava a gaveta: os R$ 200 de troco "nasciam" no
    // caixa, o saldo total da empresa crescia sem receita que explicasse e o
    // cofre de onde o dinheiro saiu continuava acusando o valor antigo.
    const cofre = { id: 'acc-cofre', name: 'Cofre', type: 'CASH', balance: 300 };
    const banco = { id: 'acc-banco', name: 'Santander', type: 'CHECKING', balance: 50 };

    beforeEach(() => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: null,
        isActive: true,
      });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 100,
        movements: [],
      });
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.financialAccount.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve([cofre, banco].find((a) => a.id === where.id) ?? null),
      );
    });

    it('debita a conta de origem e credita a gaveta', async () => {
      await service.supply(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 200,
        reason: 'Troco',
        sourceAccountId: 'acc-cofre',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-cofre' },
        data: { balance: { decrement: 200 } },
        select: { balance: true },
      });
      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: 200 } },
        select: { balance: true },
      });
      expect(allCallData(prisma.tx.financialTransaction.create)).toEqual([
        expect.objectContaining({ accountId: 'acc-cofre', type: 'DEBIT', amount: 200, referenceType: 'transfer' }),
        expect.objectContaining({ accountId: 'acc-1', type: 'CREDIT', amount: 200, referenceType: 'transfer' }),
      ]);
    });

    it('grava no movimento de onde o dinheiro veio e qual transferência o trouxe', async () => {
      await service.supply(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 200,
        reason: 'Troco',
        sourceAccountId: 'acc-cofre',
      });

      const movement = allCallData(prisma.tx.cashRegisterMovement.create)[0];
      const debit = allCallData(prisma.tx.financialTransaction.create)[0];
      expect(movement).toMatchObject({
        type: 'SUPPLY',
        amount: 200,
        counterpartAccountId: 'acc-cofre',
        transferId: debit.referenceId,
      });
      expect(movement.transferId).toEqual(expect.any(String));
    });

    it('usa o cofre do caixa quando o operador não escolhe outra conta', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        vaultAccountId: 'acc-cofre',
        isActive: true,
      });

      await service.supply(TENANT_ID, REGISTER_ID, USER_ID, { amount: 100, reason: 'Troco' });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-cofre' }, data: { balance: { decrement: 100 } } }),
      );
    });

    it('recusa suprimento sem conta de origem', async () => {
      const attempt = service.supply(TENANT_ID, REGISTER_ID, USER_ID, { amount: 100, reason: 'Troco' });

      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow(/conta de origem/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa trazer o suprimento da conta do próprio caixa', async () => {
      await expect(
        service.supply(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 100,
          reason: 'Troco',
          sourceAccountId: 'acc-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa conta de origem de outra empresa, inativa ou excluída', async () => {
      await expect(
        service.supply(TENANT_ID, REGISTER_ID, USER_ID, {
          amount: 100,
          reason: 'Troco',
          sourceAccountId: 'acc-de-outra-empresa',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.financialAccount.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acc-de-outra-empresa', tenantId: TENANT_ID, isActive: true, deletedAt: null },
        }),
      );
    });

    it('recusa tirar do cofre mais do que ele tem: conta do tipo Caixa não fica negativa', async () => {
      const attempt = service.supply(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 300.01,
        reason: 'Troco',
        sourceAccountId: 'acc-cofre',
      });

      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow(/Saldo insuficiente em "Cofre"/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('aceita suprimento de conta bancária mesmo com o saldo do sistema menor', async () => {
      // O saque no banco é real; o saldo do banco no ERP costuma estar atrasado
      // em relação ao extrato até a conciliação.
      await service.supply(TENANT_ID, REGISTER_ID, USER_ID, {
        amount: 80,
        reason: 'Saque para troco',
        sourceAccountId: 'acc-banco',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-banco' }, data: { balance: { decrement: 80 } } }),
      );
    });
  });

  describe('closeSession — transferência do excedente', () => {
    beforeEach(() => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: REGISTER_ID,
        name: 'Caixa 01',
        financialAccountId: 'acc-1',
        isActive: true,
      });
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: SESSION_ID,
        openingBalance: 50,
        movements: [],
      });
      prisma.orderPayment.aggregate.mockResolvedValue({ _sum: { amount: 349.9 } });
      prisma.tx.cashRegisterSession.update.mockResolvedValue({ id: SESSION_ID });
      prisma.financialAccount.findFirst.mockResolvedValue({
        id: 'acc-banco',
        name: 'Santander',
      });
    });

    it('deixa na gaveta o fundo retido e transfere o resto', async () => {
      const result = await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 399.9,
        retainedAmount: 50,
        destinationAccountId: 'acc-banco',
      });

      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { decrement: 349.9 } },
        select: { balance: true },
      });
      expect(prisma.tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-banco' },
        data: { balance: { increment: 349.9 } },
        select: { balance: true },
      });
      expect(result.transfer).toMatchObject({
        toAccountId: 'acc-banco',
        amount: 349.9,
      });
      expect(result.retainedAmount).toBe(50);
    });

    it('não transfere nada quando o destino não é informado', async () => {
      const result = await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 399.9,
      });

      expect(prisma.tx.financialAccount.update).not.toHaveBeenCalled();
      expect(result.transfer).toBeNull();
    });

    it('não transfere quando o fundo retido é todo o valor contado', async () => {
      const result = await service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
        closingBalance: 399.9,
        retainedAmount: 399.9,
        destinationAccountId: 'acc-banco',
      });

      expect(result.transfer).toBeNull();
      expect(prisma.tx.financialAccount.update).not.toHaveBeenCalled();
    });

    it('recusa um fundo de troco maior que o valor contado', async () => {
      await expect(
        service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
          closingBalance: 100,
          retainedAmount: 150,
          destinationAccountId: 'acc-banco',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa transferir para a conta do próprio caixa', async () => {
      await expect(
        service.closeSession(TENANT_ID, REGISTER_ID, USER_ID, {
          closingBalance: 399.9,
          retainedAmount: 50,
          destinationAccountId: 'acc-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── A baixa de um título pela conta do caixa mexe na gaveta ────────────

  describe('mirrorSettlementInDrawer', () => {
    // Pagar o reembolso de um estorno (ou a conta de luz) pela conta do caixa
    // tira dinheiro físico da gaveta. Sem o movimento, o fechamento contava uma
    // gaveta que ninguém tinha mexido e acusava diferença.
    function txWith(session: unknown) {
      return {
        cashRegisterSession: { findFirst: jest.fn().mockResolvedValue(session) },
        cashRegisterMovement: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ id: 'mov-x' }),
        },
        orderPayment: {
          aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        },
      };
    }

    const openSession = {
      id: SESSION_ID,
      openingBalance: 500,
      cashRegister: { name: 'Caixa 01' },
    };

    it('cria a sangria correspondente ao pagamento', async () => {
      const tx = txWith(openSession);

      const result = await service.mirrorSettlementInDrawer(tx as never, {
        tenantId: TENANT_ID,
        accountId: 'acc-1',
        direction: 'out',
        amount: 200,
        reason: 'Pagamento - Estorno de venda PED-000001',
        userId: USER_ID,
      });

      expect(result).toEqual({ sessionId: SESSION_ID });
      expect(tx.cashRegisterMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: SESSION_ID,
          type: 'WITHDRAW',
          amount: 200,
          performedById: USER_ID,
        }),
      });
    });

    it('registra um recebimento como suprimento', async () => {
      const tx = txWith(openSession);

      await service.mirrorSettlementInDrawer(tx as never, {
        tenantId: TENANT_ID,
        accountId: 'acc-1',
        direction: 'in',
        amount: 80,
        reason: 'Recebimento - Título X',
        userId: USER_ID,
      });

      expect(tx.cashRegisterMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'SUPPLY', amount: 80 }),
      });
    });

    it('não faz nada quando a conta não é de um caixa aberto', async () => {
      const tx = txWith(null);

      const result = await service.mirrorSettlementInDrawer(tx as never, {
        tenantId: TENANT_ID,
        accountId: 'acc-banco',
        direction: 'out',
        amount: 200,
        reason: 'Pagamento - Aluguel',
        userId: USER_ID,
      });

      expect(result).toBeNull();
      expect(tx.cashRegisterMovement.create).not.toHaveBeenCalled();
    });

    it('recusa um pagamento maior que o saldo da gaveta (FN-06)', async () => {
      const tx = txWith(openSession);

      await expect(
        service.mirrorSettlementInDrawer(tx as never, {
          tenantId: TENANT_ID,
          accountId: 'acc-1',
          direction: 'out',
          amount: 900,
          reason: 'Pagamento - Fornecedor',
          userId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(tx.cashRegisterMovement.create).not.toHaveBeenCalled();
    });
  });
});
