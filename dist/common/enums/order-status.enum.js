"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderStatus = void 0;
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["DRAFT"] = "draft";
    OrderStatus["PENDING_APPROVAL"] = "pending_approval";
    OrderStatus["SUBMITTED"] = "submitted";
    OrderStatus["COUNTER_OFFER"] = "counter_offer";
    OrderStatus["ACCEPTED"] = "accepted";
    OrderStatus["BACK_ORDERED"] = "back_ordered";
    OrderStatus["SHIPPED"] = "shipped";
    OrderStatus["FAILED_DELIVERY"] = "failed_delivery";
    OrderStatus["ON_HOLD"] = "on_hold";
    OrderStatus["RECEIVED_PENDING_QC"] = "received_pending_qc";
    OrderStatus["DELIVERED"] = "delivered";
    OrderStatus["PARTIALLY_DELIVERED"] = "partially_delivered";
    OrderStatus["DISPUTED"] = "disputed";
    OrderStatus["RETURN_REQUESTED"] = "return_requested";
    OrderStatus["RETURN_APPROVED"] = "return_approved";
    OrderStatus["RETURN_IN_TRANSIT"] = "return_in_transit";
    OrderStatus["RETURN_RECEIVED"] = "return_received";
    OrderStatus["CREDIT_ISSUED"] = "credit_issued";
    OrderStatus["CANCELLED"] = "cancelled";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
//# sourceMappingURL=order-status.enum.js.map