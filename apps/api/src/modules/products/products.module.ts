import { Module } from '@nestjs/common';
import { ProductLookupController } from './product-lookup.controller';
import { ProductLookupService } from './product-lookup.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  // The lookup controller comes first: `GET /products/lookup` must win over
  // `GET /products/:id`.
  controllers: [ProductLookupController, ProductsController],
  providers: [ProductsService, ProductLookupService],
  exports: [ProductsService],
})
export class ProductsModule {}
