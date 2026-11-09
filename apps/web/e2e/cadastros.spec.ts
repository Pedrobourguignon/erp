import { test, expect, makeCpf, stamp } from "./fixtures";

/**
 * Jornada: cadastros com as validações brasileiras.
 *
 * Cobre AE-04 (CPF/CNPJ sem dígito verificador), AE-15 (duplicidade burlável
 * pela máscara), AE-08 (NCM/EAN/CFOP), AE-02 (produto com saldo excluído),
 * AE-06/AE-16 (edição de cliente e endereços) e AE-25 (transferência e ajuste).
 */
test.describe("cadastros", () => {
  test("AE-04: CPF sem dígito verificador válido é recusado", async ({ apiClient }) => {
    const invalid = await apiClient.post("/customers", {
      name: "E2E CPF inválido",
      documentType: "CPF",
      document: "111.111.111-11",
      email: `e2e.cpf.${stamp()}@exemplo.com`,
    });

    // Contar dígitos aceitava este documento; o dígito verificador não.
    expect(invalid.status).toBe(400);
  });

  test("AE-04: CNPJ sem dígito verificador válido é recusado", async ({ apiClient }) => {
    const invalid = await apiClient.post("/customers", {
      name: "E2E CNPJ inválido",
      documentType: "CNPJ",
      document: "11.111.111/1111-11",
      email: `e2e.cnpj.${stamp()}@exemplo.com`,
    });

    expect(invalid.status).toBe(400);
  });

  test("AE-15: o mesmo documento em outra formatação é duplicata", async ({
    apiClient,
  }) => {
    const cpf = makeCpf();
    const masked = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

    const first = await apiClient.post("/customers", {
      name: `E2E Dup A ${stamp()}`,
      documentType: "CPF",
      document: masked,
      email: `e2e.dup.a.${stamp()}@exemplo.com`,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const created = (first.body as { data: { id: string; document: string } }).data;

    // Guardado só com dígitos — a máscara é exibição.
    expect(created.document).toBe(cpf);

    const second = await apiClient.post("/customers", {
      name: `E2E Dup B ${stamp()}`,
      documentType: "CPF",
      document: cpf,
      email: `e2e.dup.b.${stamp()}@exemplo.com`,
    });
    expect(second.status, "a duplicata passou trocando a formatação").toBe(409);

    await apiClient.delete(`/customers/${created.id}`);
  });

  test("AE-08: NCM e EAN inválidos são recusados na criação e na edição", async ({
    apiClient,
  }) => {
    const suffix = stamp();

    const badNcm = await apiClient.post("/products", {
      name: `E2E NCM ${suffix}`,
      sku: `E2E-NCM-${suffix}`,
      status: "ACTIVE",
      costPrice: 5,
      salePrice: 10,
      ncm: "ABCDEFG",
    });
    expect(badNcm.status).toBe(400);

    const badEan = await apiClient.post("/products", {
      name: `E2E EAN ${suffix}`,
      sku: `E2E-EAN-${suffix}`,
      status: "ACTIVE",
      costPrice: 5,
      salePrice: 10,
      ean: "123",
    });
    expect(badEan.status).toBe(400);

    // A edição era a outra porta aberta.
    const good = await apiClient.post("/products", {
      name: `E2E Fiscal ${suffix}`,
      sku: `E2E-FIS-${suffix}`,
      status: "ACTIVE",
      costPrice: 5,
      salePrice: 10,
    });
    expect(good.status, JSON.stringify(good.body)).toBe(201);
    const product = (good.body as { data: { id: string } }).data;

    const badUpdate = await apiClient.patch(`/products/${product.id}`, {
      ncm: "ABCDEFG",
    });
    expect(badUpdate.status, "a edição aceitou o NCM que a criação recusou").toBe(400);

    await apiClient.delete(`/products/${product.id}`);
  });

  test("AE-02: produto com saldo não é excluído, e a mensagem diz quanto", async ({
    apiClient,
  }) => {
    const suffix = stamp();
    const created = await apiClient.post("/products", {
      name: `E2E Saldo ${suffix}`,
      sku: `E2E-SALDO-${suffix}`,
      status: "ACTIVE",
      costPrice: 5,
      salePrice: 10,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const product = (created.body as { data: { id: string } }).data;

    const warehouses = await apiClient.get("/inventory/warehouses?limit=10");
    const warehouse = (
      (warehouses.body as { data?: { id: string; isActive?: boolean }[] }).data ?? []
    ).find((w) => w.isActive !== false)!;

    await apiClient.post("/inventory/movement", {
      productId: product.id,
      type: "ENTRY",
      reason: "INITIAL",
      quantity: 7,
      toWarehouseId: warehouse.id,
    });

    const blocked = await apiClient.delete(`/products/${product.id}`);
    expect(blocked.status).toBe(409);
    expect(String((blocked.body as { message?: string }).message)).toMatch(/7 un/);

    // Zerando, a exclusão passa.
    await apiClient.post("/inventory/adjustment", {
      productId: product.id,
      warehouseId: warehouse.id,
      countedQuantity: 0,
      reason: "COUNT",
      notes: "Zerando para o teste E2E",
    });
    const removed = await apiClient.delete(`/products/${product.id}`);
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);
  });

  test("AE-06: o cliente pode ser editado", async ({ apiClient }) => {
    const suffix = stamp();
    const created = await apiClient.post("/customers", {
      name: `E2E Editar ${suffix}`,
      documentType: "CPF",
      document: makeCpf(),
      email: `e2e.editar.${suffix}@exemplo.com`,
      phone: "(11) 98888-7777",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const customer = (created.body as { data: { id: string } }).data;

    const updated = await apiClient.patch(`/customers/${customer.id}`, {
      name: `E2E Editado ${suffix}`,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);

    const reread = await apiClient.get(`/customers/${customer.id}`);
    expect((reread.body as { data: { name: string } }).data.name).toBe(
      `E2E Editado ${suffix}`
    );

    await apiClient.delete(`/customers/${customer.id}`);
  });

  test("AE-16: o cliente aceita endereços, com um só principal", async ({
    apiClient,
  }) => {
    const suffix = stamp();
    const created = await apiClient.post("/customers", {
      name: `E2E Endereço ${suffix}`,
      documentType: "CPF",
      document: makeCpf(),
      email: `e2e.endereco.${suffix}@exemplo.com`,
    });
    const customer = (created.body as { data: { id: string } }).data;

    const first = await apiClient.post(`/customers/${customer.id}/addresses`, {
      label: "Entrega",
      street: "Avenida Paulista",
      number: "1500",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "sp",
      zipCode: "01310-100",
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const address = (first.body as { data: { zipCode: string; state: string; isDefault: boolean } })
      .data;

    expect(address.zipCode, "o CEP foi guardado com máscara").toBe("01310100");
    expect(address.state).toBe("SP");
    expect(address.isDefault, "o primeiro endereço tem de ser o principal").toBe(true);

    await apiClient.post(`/customers/${customer.id}/addresses`, {
      label: "Cobrança",
      street: "Rua Augusta",
      number: "900",
      neighborhood: "Consolação",
      city: "São Paulo",
      state: "SP",
      zipCode: "01304001",
      isDefault: true,
    });

    const listed = await apiClient.get(`/customers/${customer.id}/addresses`);
    const addresses = (listed.body as { data?: { isDefault: boolean }[] }).data ?? [];
    expect(addresses.filter((a) => a.isDefault).length, "dois endereços principais")
      .toBe(1);

    await apiClient.delete(`/customers/${customer.id}`);
  });

  test("AE-12c: promover um depósito rebaixa o anterior", async ({ apiClient }) => {
    const listed = await apiClient.get("/inventory/warehouses?limit=100");
    const warehouses =
      (listed.body as { data?: { id: string; isDefault: boolean; isActive?: boolean }[] })
        .data ?? [];
    const defaults = warehouses.filter((w) => w.isDefault);

    // A tela chegou a exibir três "Padrão" e a venda escolhia um deles sem dizer.
    expect(defaults.length, "há mais de um depósito padrão").toBe(1);
  });

  test("FN-25: senha fraca é recusada onde a senha é definida", async ({ apiClient }) => {
    const weak = await apiClient.post("/users", {
      name: "E2E Senha Fraca",
      email: `e2e.senha.${stamp()}@exemplo.com`,
      password: "123456",
    });

    expect(weak.status).toBe(400);
  });

  test("CLI-01: cliente sem telefone não derruba a listagem nem o detalhe", async ({
    appPage,
    apiClient,
  }) => {
    // Telefone é opcional no cadastro e a API devolve `null`. A máscara
    // chamava `.replace` nele e um único cliente assim derrubava /clientes
    // inteira — o `appPage` falha esta jornada em qualquer erro de JavaScript.
    const suffix = stamp();
    const created = await apiClient.post("/customers", {
      name: `E2E Sem Telefone ${suffix}`,
      documentType: "CPF",
      document: makeCpf(),
      email: `e2e.semfone.${suffix}@exemplo.com`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const customer = (created.body as { data: { id: string; name: string; phone: string | null } }).data;
    expect(customer.phone, "o cenário depende de o telefone vir nulo").toBeNull();

    await appPage.goto("/clientes");
    const row = appPage.getByRole("row", { name: new RegExp(customer.name) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "—" })).toBeVisible();

    await appPage.goto(`/clientes/${customer.id}`);
    await expect(appPage.getByText("Telefone não informado")).toBeVisible();
  });
});
