/**
 * Rótulo do tipo de cliente, deduzido do documento.
 *
 * CPF e CNPJ são opcionais no cadastro; um cliente sem documento não é pessoa
 * física nem jurídica — é "sem documento".
 */
export function customerTypeLabel(documentType: string | null | undefined): string {
  if (documentType === "CPF") {
    return "Pessoa Física";
  }
  if (documentType === "CNPJ") {
    return "Pessoa Jurídica";
  }
  return "Sem documento";
}
