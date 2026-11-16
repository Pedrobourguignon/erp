import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomersService } from './customers.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto, CustomerQueryDto } from './dto/customer.dto';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = 'tenant-aaa-111';
const TENANT_B = 'tenant-bbb-222';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-001',
    tenantId: TENANT_A,
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+5511999990000',
    document: '12345678901',
    documentType: 'CPF',
    tradeName: null,
    segment: 'RETAIL',
    tags: ['vip'],
    score: 0,
    notes: null,
    metadata: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    addresses: [],
    ...overrides,
  };
}

// ─── Mock Factory ─────────────────────────────────────────────────────────────

function createMockPrisma() {
  const mockTx = {
    customerAddress: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  return {
    customer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    customerAddress: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
    _tx: mockTx,
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const baseDto: CreateCustomerDto = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+5511888880000',
      document: '98765432100',
      documentType: 'CPF',
    };

    it('should create customer with valid data', async () => {
      prisma.customer.findFirst.mockResolvedValue(null); // no duplicate doc
      const created = makeCustomer({ name: 'Jane Doe', email: 'jane@example.com', document: '98765432100' });
      prisma.customer.create.mockResolvedValue(created);

      const result = await service.create(TENANT_A, baseDto);

      expect(result.name).toBe('Jane Doe');
      expect(prisma.customer.create).toHaveBeenCalledTimes(1);

      const createArgs = prisma.customer.create.mock.calls[0][0];
      expect(createArgs.data.tenantId).toBe(TENANT_A);
      expect(createArgs.data.name).toBe('Jane Doe');
    });

    // ─── CPF/CNPJ e e-mail são opcionais; data de nascimento também ──────

    it('creates a customer with no document and no e-mail', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue(makeCustomer());

      await service.create(TENANT_A, { name: 'Cliente de balcão', phone: '11999990000' });

      const data = prisma.customer.create.mock.calls[0][0].data;
      expect(data.document).toBeUndefined();
      expect(data.email).toBeUndefined();
      // sem documento nem e-mail não há o que checar de duplicidade
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    });

    describe('birth date', () => {
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-12T13:00:00.000Z'));
        prisma.customer.findFirst.mockResolvedValue(null);
        prisma.customer.create.mockResolvedValue(makeCustomer());
      });
      afterEach(() => jest.useRealTimers());

      it('stores it as a civil date: midnight in the tenant timezone', async () => {
        await service.create(TENANT_A, { ...baseDto, birthDate: '1990-05-20' });

        // 20/05/1990 00:00 em Brasília — e não 21:00 do dia 19 (FN-02)
        expect(prisma.customer.create.mock.calls[0][0].data.birthDate).toEqual(
          new Date('1990-05-20T03:00:00.000Z'),
        );
      });

      it('is optional', async () => {
        await service.create(TENANT_A, baseDto);

        expect(prisma.customer.create.mock.calls[0][0].data.birthDate).toBeUndefined();
      });

      it('accepts someone born today', async () => {
        await service.create(TENANT_A, { ...baseDto, birthDate: '2026-11-12' });

        expect(prisma.customer.create).toHaveBeenCalled();
      });

      it.each([
        ['in the future', '2026-11-13', 'A data de nascimento não pode ser no futuro.'],
        ['before 1900', '1899-12-31', 'Informe uma data de nascimento a partir de 1900.'],
        ['that does not exist', '1990-02-31', 'Data de nascimento inválida.'],
      ])('refuses a birth date %s, in Portuguese', async (_label, birthDate, message) => {
        await expect(
          service.create(TENANT_A, { ...baseDto, birthDate }),
        ).rejects.toThrow(new BadRequestException(message));
        expect(prisma.customer.create).not.toHaveBeenCalled();
      });

      it.each([
        ['an invalid CPF', 'CPF', '111.111.111-11'],
        ['an invalid CNPJ', 'CNPJ', '11.111.111/1111-11'],
      ])('refuses %s at the door (AE-04), but a blank document is fine', async (_l, documentType, document) => {
        const bad = plainToInstance(CreateCustomerDto, { name: 'Ana', documentType, document });
        const none = plainToInstance(CreateCustomerDto, { name: 'Ana' });
        const nulled = plainToInstance(CreateCustomerDto, { name: 'Ana', document: null, documentType: null });

        expect((await validate(bad)).map((e) => e.property)).toContain('document');
        expect(await validate(none)).toHaveLength(0);
        expect(await validate(nulled)).toHaveLength(0);
      });

      it('only accepts YYYY-MM-DD at the door (DTO)', async () => {
        const bad = plainToInstance(CreateCustomerDto, { name: 'Ana', birthDate: '20/05/1990' });
        const good = plainToInstance(CreateCustomerDto, { name: 'Ana', birthDate: '1990-05-20' });
        const none = plainToInstance(CreateCustomerDto, { name: 'Ana' });

        expect((await validate(bad)).map((e) => e.property)).toContain('birthDate');
        expect(await validate(good)).toHaveLength(0);
        expect(await validate(none)).toHaveLength(0);
      });
    });

    // ─── AE-15: o documento é guardado só com dígitos ────────────────────

    it('stores the document with digits only', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue(makeCustomer({}));

      await service.create(TENANT_A, {
        ...baseDto,
        document: '987.654.321-00',
      });

      const data = prisma.customer.create.mock.calls[0][0].data;
      expect(data.document).toBe('98765432100');
    });

    it('finds the duplicate even when the mask differs', async () => {
      // `12345678909` e `123.456.789-09` conviviam como clientes diferentes
      // porque a checagem comparava a string com a máscara.
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue(makeCustomer({}));

      await service.create(TENANT_A, { ...baseDto, document: '987.654.321-00' });

      const where = prisma.customer.findFirst.mock.calls[0][0].where;
      expect(where.document).toBe('98765432100');
    });

    it('leaves a customer without document alone', async () => {
      prisma.customer.create.mockResolvedValue(makeCustomer({}));

      await service.create(TENANT_A, {
        name: 'Sem documento',
      } as CreateCustomerDto);

      const data = prisma.customer.create.mock.calls[0][0].data;
      expect(data.document).toBeUndefined();
    });

    it('should throw ConflictException when duplicate document exists for tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(makeCustomer()); // duplicate found

      await expect(service.create(TENANT_A, baseDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when duplicate email exists for tenant', async () => {
      // First call (document check) returns null, second call (email check) returns existing
      prisma.customer.findFirst
        .mockResolvedValueOnce(null) // no duplicate doc
        .mockResolvedValueOnce(makeCustomer()); // duplicate email

      await expect(service.create(TENANT_A, baseDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('should allow same document in different tenants', async () => {
      prisma.customer.findFirst.mockResolvedValue(null); // no duplicate
      prisma.customer.create.mockResolvedValue(makeCustomer({ tenantId: TENANT_B }));

      await service.create(TENANT_B, baseDto);

      const findArgs = prisma.customer.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_B);
      expect(prisma.customer.create).toHaveBeenCalledTimes(1);
    });

    it('should create customer without document (no duplicate check)', async () => {
      const dto: CreateCustomerDto = { name: 'No Doc Customer' };
      prisma.customer.create.mockResolvedValue(makeCustomer({ document: null }));

      const result = await service.create(TENANT_A, dto);

      expect(result).toBeDefined();
      // findFirst should not be called for document check when document is not provided
      // (it may be called for email check if email is provided)
    });

    it('should set tags to empty array when not provided', async () => {
      const dto: CreateCustomerDto = { name: 'No Tags' };
      prisma.customer.create.mockResolvedValue(makeCustomer({ tags: [] }));

      await service.create(TENANT_A, dto);

      const createArgs = prisma.customer.create.mock.calls[0][0];
      expect(createArgs.data.tags).toEqual([]);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  // ─── AE-13: as colunas "Pedidos" e "Total Gasto" vinham sempre vazias ──

  describe('order totals in the list (AE-13)', () => {
    // A tabela lia `totalOrders` e `totalSpent`; a API devolvia `_count.orders`
    // e mais nada. `undefined` renderiza como vazio e como R$ 0,00 — ninguém
    // percebe que a coluna está quebrada, só que o cliente "não comprou nada".
    beforeEach(() => {
      prisma.customer.count.mockResolvedValue(1);
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust-001',
          name: 'Maria',
          _count: { orders: 3 },
          orders: [
            { totalAmount: 100.5 },
            { totalAmount: 200.25 },
            { totalAmount: 50 },
          ],
        },
      ]);
    });

    it('returns totalOrders and totalSpent, the fields the table reads', async () => {
      const result = await service.findAll(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({
        totalOrders: 3,
        totalSpent: 350.75,
      });
    });

    it('does not leak the raw relation into the response', async () => {
      const result = await service.findAll(TENANT_A, { page: 1, limit: 20 });

      expect((result.data[0] as Record<string, unknown>).orders).toBeUndefined();
      expect((result.data[0] as Record<string, unknown>)._count).toBeUndefined();
    });

    it('is zero for a customer that never ordered', async () => {
      prisma.customer.findMany.mockResolvedValue([
        { id: 'cust-002', name: 'Sem pedidos', _count: { orders: 0 }, orders: [] },
      ]);

      const result = await service.findAll(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({ totalOrders: 0, totalSpent: 0 });
    });

    it('sums in cents — three orders must not drift', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust-003',
          name: 'Centavos',
          _count: { orders: 2 },
          orders: [{ totalAmount: 299.8 }, { totalAmount: 409.1 }],
        },
      ]);

      const result = await service.findAll(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({ totalSpent: 708.9 });
    });

    it('counts only orders that were not cancelled', async () => {
      await service.findAll(TENANT_A, { page: 1, limit: 20 });

      const args = prisma.customer.findMany.mock.calls[0][0];
      expect(args.select.orders.where.status).toEqual({
        notIn: ['CANCELLED', 'RETURNED', 'DRAFT'],
      });
    });
  });

  describe('findAll', () => {
    const defaultQuery: CustomerQueryDto = { page: 1, limit: 20, sortOrder: 'desc' };

    it('should return paginated customers for tenant', async () => {
      const customers = [makeCustomer()];
      prisma.customer.findMany.mockResolvedValue(customers);
      prisma.customer.count.mockResolvedValue(1);

      const result = await service.findAll(TENANT_A, defaultQuery);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);

      const whereArg = prisma.customer.findMany.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
      expect(whereArg.deletedAt).toBeNull();
    });

    it('should search by name, email, document, phone', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { ...defaultQuery, search: 'John' });

      const whereArg = prisma.customer.findMany.mock.calls[0][0].where;
      expect(whereArg.OR).toBeDefined();
      expect(whereArg.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: { contains: 'John', mode: 'insensitive' } }),
          expect.objectContaining({ email: { contains: 'John', mode: 'insensitive' } }),
          expect.objectContaining({ document: { contains: 'John', mode: 'insensitive' } }),
        ]),
      );
    });

    it('should filter by segment', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { ...defaultQuery, segment: 'RETAIL' });

      const whereArg = prisma.customer.findMany.mock.calls[0][0].where;
      expect(whereArg.segment).toBe('RETAIL');
    });

    it('should filter by tag', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { ...defaultQuery, tag: 'vip' });

      const whereArg = prisma.customer.findMany.mock.calls[0][0].where;
      expect(whereArg.tags).toEqual({ has: 'vip' });
    });

    it('should NOT return customers from other tenants', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, defaultQuery);

      const whereArg = prisma.customer.findMany.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
      expect(whereArg.tenantId).not.toBe(TENANT_B);
    });

    it('should NOT return soft-deleted customers', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, defaultQuery);

      const whereArg = prisma.customer.findMany.mock.calls[0][0].where;
      expect(whereArg.deletedAt).toBeNull();
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return customer with addresses and interactions', async () => {
      const customer = makeCustomer({ addresses: [], interactions: [], _count: { orders: 5, invoices: 2 } });
      prisma.customer.findFirst.mockResolvedValue(customer);

      const result = await service.findById(TENANT_A, 'cust-001');

      expect(result).toEqual(customer);
      const findArgs = prisma.customer.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
      expect(findArgs.where.deletedAt).toBeNull();
    });

    it('should throw NotFoundException when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findById(TENANT_A, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when customer belongs to another tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findById(TENANT_A, 'cust-of-tenant-b')).rejects.toThrow(
        NotFoundException,
      );

      const findArgs = prisma.customer.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update customer fields', async () => {
      prisma.customer.findFirst.mockResolvedValue(makeCustomer());
      prisma.customer.update.mockResolvedValue(makeCustomer({ name: 'Updated Name' }));

      const dto: UpdateCustomerDto = { name: 'Updated Name' };
      const result = await service.update(TENANT_A, 'cust-001', dto);

      expect(result.name).toBe('Updated Name');
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);
    });

    describe('optional fields', () => {
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-12T13:00:00.000Z'));
        prisma.customer.findFirst.mockResolvedValue(
          makeCustomer({ email: 'a@b.com', document: '12345678901', birthDate: new Date('1990-05-20T03:00:00.000Z') }),
        );
        prisma.customer.update.mockResolvedValue(makeCustomer());
      });
      afterEach(() => jest.useRealTimers());

      it('updates the birth date as a civil date', async () => {
        await service.update(TENANT_A, 'cust-001', { birthDate: '1985-07-01' });

        expect(prisma.customer.update.mock.calls[0][0].data.birthDate).toEqual(
          new Date('1985-07-01T03:00:00.000Z'),
        );
      });

      it('refuses a future birth date on update too', async () => {
        await expect(
          service.update(TENANT_A, 'cust-001', { birthDate: '2027-01-01' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('leaves the birth date alone when it is not sent', async () => {
        await service.update(TENANT_A, 'cust-001', { name: 'Outro nome' });

        expect(prisma.customer.update.mock.calls[0][0].data.birthDate).toBeUndefined();
      });

      it('clears birth date, e-mail and document when null is sent', async () => {
        await service.update(TENANT_A, 'cust-001', {
          birthDate: null,
          email: null,
          document: null,
        } as UpdateCustomerDto);

        const data = prisma.customer.update.mock.calls[0][0].data;
        expect(data.birthDate).toBeNull();
        expect(data.email).toBeNull();
        expect(data.document).toBeNull();
        expect(data.documentType).toBeNull();
      });
    });

    it('should throw NotFoundException when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update(TENANT_A, 'nonexistent', { name: 'Nope' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when updated document collides', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce(makeCustomer({ document: '52998224725' })) // existing customer
        .mockResolvedValueOnce(
          makeCustomer({ id: 'other-cust', document: '98765432100' }),
        ); // collision

      await expect(
        service.update(TENANT_A, 'cust-001', { document: '987.654.321-00' }),
      ).rejects.toThrow(ConflictException);
    });

    it('sees through the mask when checking the collision (AE-15)', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce(makeCustomer({ document: '52998224725' }))
        .mockResolvedValueOnce(
          makeCustomer({ id: 'other-cust', document: '98765432100' }),
        );

      await expect(
        service.update(TENANT_A, 'cust-001', { document: '987.654.321-00' }),
      ).rejects.toThrow(ConflictException);

      const where = prisma.customer.findFirst.mock.calls[1][0].where;
      expect(where.document).toBe('98765432100');
    });

    it('should verify tenant isolation on update', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update(TENANT_A, 'cust-of-tenant-b', { name: 'Hack' }),
      ).rejects.toThrow(NotFoundException);

      const findArgs = prisma.customer.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
    });
  });

  // ─── remove (soft delete) ─────────────────────────────────────────────────

  describe('remove', () => {
    it('should set deletedAt timestamp (soft delete)', async () => {
      prisma.customer.findFirst.mockResolvedValue(makeCustomer());
      prisma.customer.update.mockResolvedValue(makeCustomer({ deletedAt: new Date() }));

      const result = await service.remove(TENANT_A, 'cust-001');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Cliente removido com sucesso');

      const updateArgs = prisma.customer.update.mock.calls[0][0];
      expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.remove(TENANT_A, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should verify tenant isolation on delete', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.remove(TENANT_A, 'cust-of-tenant-b')).rejects.toThrow(
        NotFoundException,
      );

      const findArgs = prisma.customer.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
    });
  });
  // ─── Addresses (AE-16) ────────────────────────────────────────────────────

  describe('customer addresses', () => {
    const CUSTOMER_ID = 'cust-001';
    const dto = {
      label: 'Entrega',
      street: 'Avenida Paulista',
      number: '1500',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'sp',
      zipCode: '01310-100',
    };

    beforeEach(() => {
      prisma.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID });
      prisma.customerAddress.count.mockResolvedValue(1);
      prisma._tx.customerAddress.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({ id: 'addr-1', ...data }),
      );
      prisma._tx.customerAddress.update.mockResolvedValue({ id: 'addr-1' });
      prisma._tx.customerAddress.updateMany.mockResolvedValue({ count: 0 });
    });

    it('should scope the customer lookup by tenant before touching addresses', async () => {
      // CustomerAddress has no tenantId of its own — it is reachable only
      // through the customer, so this check is the whole isolation.
      await service.findAddresses(TENANT_A, CUSTOMER_ID);

      expect(prisma.customer.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT_A);
    });

    it('should refuse an address of a customer from another tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.createAddress(TENANT_B, CUSTOMER_ID, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should store the CEP with digits only and the UF uppercased', async () => {
      const address = await service.createAddress(TENANT_A, CUSTOMER_ID, dto);

      expect(address.zipCode).toBe('01310100');
      expect(address.state).toBe('SP');
    });

    it('should make the first address the default even without the flag', async () => {
      prisma.customerAddress.count.mockResolvedValue(0);

      const address = await service.createAddress(TENANT_A, CUSTOMER_ID, dto);

      expect(address.isDefault).toBe(true);
    });

    it('should not promote a later address unless asked', async () => {
      const address = await service.createAddress(TENANT_A, CUSTOMER_ID, dto);

      expect(address.isDefault).toBe(false);
    });

    it('should demote the previous default in the same transaction', async () => {
      // AE-12c on the customer side: two addresses marked as the main one is
      // the same failure as three "Padrão" warehouses.
      await service.createAddress(TENANT_A, CUSTOMER_ID, { ...dto, isDefault: true });

      expect(prisma._tx.customerAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId: CUSTOMER_ID, isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should refuse to update an address of another customer', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAddress(TENANT_A, CUSTOMER_ID, 'addr-x', { city: 'Campinas' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not let the default be un-ticked into nothing', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue({
        id: 'addr-1',
        customerId: CUSTOMER_ID,
        isDefault: true,
      });

      await service.updateAddress(TENANT_A, CUSTOMER_ID, 'addr-1', {
        isDefault: false,
      });

      const data = prisma._tx.customerAddress.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('isDefault');
    });

    it('should promote the oldest survivor when the default is deleted', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue({
        id: 'addr-1',
        customerId: CUSTOMER_ID,
        isDefault: true,
      });
      prisma._tx.customerAddress.findFirst.mockResolvedValue({ id: 'addr-2' });

      await service.removeAddress(TENANT_A, CUSTOMER_ID, 'addr-1');

      expect(prisma._tx.customerAddress.delete).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
      });
      expect(prisma._tx.customerAddress.update).toHaveBeenCalledWith({
        where: { id: 'addr-2' },
        data: { isDefault: true },
      });
    });

    it('should not promote anything when a non-default address is deleted', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue({
        id: 'addr-2',
        customerId: CUSTOMER_ID,
        isDefault: false,
      });

      await service.removeAddress(TENANT_A, CUSTOMER_ID, 'addr-2');

      expect(prisma._tx.customerAddress.update).not.toHaveBeenCalled();
    });
  });
});
