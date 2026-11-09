-- CreateTable
CREATE TABLE "_PaymentConditionToPaymentMethod" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_PaymentConditionToPaymentMethod_AB_unique" ON "_PaymentConditionToPaymentMethod"("A", "B");

-- CreateIndex
CREATE INDEX "_PaymentConditionToPaymentMethod_B_index" ON "_PaymentConditionToPaymentMethod"("B");

-- AddForeignKey
ALTER TABLE "_PaymentConditionToPaymentMethod" ADD CONSTRAINT "_PaymentConditionToPaymentMethod_A_fkey" FOREIGN KEY ("A") REFERENCES "payment_conditions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PaymentConditionToPaymentMethod" ADD CONSTRAINT "_PaymentConditionToPaymentMethod_B_fkey" FOREIGN KEY ("B") REFERENCES "payment_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
