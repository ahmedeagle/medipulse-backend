"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateCatalogItemDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const create_catalog_item_dto_1 = require("./create-catalog-item.dto");
class UpdateCatalogItemDto extends (0, swagger_1.PartialType)(create_catalog_item_dto_1.CreateCatalogItemDto) {
}
exports.UpdateCatalogItemDto = UpdateCatalogItemDto;
//# sourceMappingURL=update-catalog-item.dto.js.map