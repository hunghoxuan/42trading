export function getBrokerTicket(row = {}) {
  return String(row?.broker_trade_id || row?.ticket || "").trim() || "-";
}
