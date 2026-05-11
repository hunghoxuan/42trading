
---

## CỔNG PRE-TRADE — Trả lời TẤT CẢ trước khi tiến hành
> Nếu bất kỳ câu trả lời nào là KHÔNG → không xây dựng kế hoạch. Dừng tại đây.

1. Thiên kiến HTF có rõ ràng và D + 4H cùng chiều không?
2. Hiện tại có đang trong killzone London (02:00–05:00 EST) hoặc NY (07:00–10:00 EST) không?
3. Không có tin tức tác động lớn trong 30 phút tới không?
4. BOS hoặc CHoCH đã xác nhận trên 15M theo chiều thiên kiến HTF (nến đã đóng cửa)?
5. Giá có đang trong vùng discount (mua) hoặc premium (bán) của swing HTF không?
6. Đã xác định được DOL rõ ràng và có thể đạt được trong ADR còn lại không?
7. Trigger vào lệnh từ nến ĐÃ ĐÓNG CỬA — không phải nến đang chạy?
8. RR ≥ 2 với vị trí SL đã lên kế hoạch không?
9. Đã tính kích thước vị thế và nằm trong giới hạn 1% rủi ro tối đa không?
10. Đã xác định mức invalidation giữa lệnh trước khi vào chưa?

---

## BỘ LỌC CHẤT LƯỢNG — Áp dụng ở mọi bước

**Sự sạch sẽ của cấu trúc:** Nếu 15M có >60% body nến chồng lấp trong 20 nến gần nhất → cấu trúc rối loạn → bỏ qua. Chỉ giao dịch các swing rõ ràng, mạnh, có đỉnh/đáy phân biệt.

**Xếp chồng confluence:** Vùng vào lệnh phải có ≥ 2 PD arrays chồng nhau (ví dụ: OB + FVG, OB + Fib 0.618–0.79, Breaker + FVG). Entry chỉ một PD array đơn lẻ tối đa là grade C.

**Quy tắc nến đóng cửa:** KHÔNG BAO GIỜ vào lệnh trên nến đang chạy. Trigger chỉ hợp lệ khi nến 15M xác nhận đóng cửa trong vùng hoặc vượt qua mức.

**Quy tắc ADR còn lại:** ADR còn lại phải ≥ 2× khoảng cách SL để đạt TP1. Nếu ADR đã tiêu thụ >70% → không mở lệnh mới trừ scalp.

**Đồng thuận DXY (đặc thù USDCAD):** Kiểm tra DXY trên 4H. DXY tăng → USD mạnh → hỗ trợ mua USDCAD. DXY giảm → hỗ trợ bán USDCAD. Mâu thuẫn giữa DXY 4H và chiều lệnh = trừ điểm Medium.

**Tương quan nghịch dầu thô (đặc thù USDCAD):** Dầu thô và CAD tương quan thuận. Dầu tăng → CAD mạnh → áp lực bán USDCAD. Dầu giảm → áp lực mua USDCAD. Xác nhận chiều dầu trên 4H trước khi vào lệnh.

**Thanh khoản đã được lấy trước entry:** Với lệnh mua: SSL gần nhất (đáy swing) đã bị quét chưa? Với lệnh bán: BSL đã bị quét chưa? Vào lệnh khi thanh khoản phía của bạn chưa bị quét = vào trước trigger tổ chức. Đây là cổng chất lượng quan trọng.

**Tiếp cận vùng weekly:** Nếu giá trong phạm vi 10 pip so với Weekly Open, PDH, hoặc PDL → các mức này là nam châm. Tính vào việc chọn DOL. Tránh đặt TP1 vượt qua mức weekly mà không có confluence.

**Quy tắc thua lỗ liên tiếp:** Sau 2 lần SL liên tiếp trên USDCAD trong cùng phiên → dừng giao dịch phiên đó. Tiếp tục ở killzone kế tiếp.

**Kiểm tra delivery giá:** Động thái giá đến vùng entry là tính chất corrective (chồng lấp, chậm) hay impulsive (sạch, định hướng)? Delivery corrective vào OB = xác suất mitigation cao hơn. Delivery impulsive qua vùng của bạn = vùng có thể đã bị phá.

---

## BƯỚC 1 — PHÂN TÍCH HTF (D và 4H)

Với mỗi khung HTF, xác định:
- **Xu hướng:** Tăng (chuỗi HH/HL) | Giảm (chuỗi LH/LL) | Đi ngang
- **Thiên kiến:** Long (BOS lên hoặc CHoCH bull gần nhất) | Short (BOS xuống hoặc CHoCH bear) | Neutral
- **what_price_just_did:** Một câu mô tả thực tế quá khứ.
- **what_price_likely_does_next:** Một câu dự báo tương lai.
- **Draw on Liquidity:** BSL/SSL chưa quét hoặc FVG HTF chưa lấp gần nhất. Giải thích TẠI SAO trong narrative. Đây là TP2 hoặc TP3.
- **Reference Zones:** Chỉ map vùng có vai trò cụ thể. ID: `D-OB-1`, `4H-FVG-2`.
  - `TP_Target` | `Entry_Boundary` | `DOL` | `Invalidation`

HTF không cung cấp tín hiệu vào lệnh và không chấm điểm confluence.

---

## BƯỚC 2 — PHÂN TÍCH LTF (15M và 5M)

- **Cấu trúc:** Chuỗi BOS/CHoCH phải thẳng hàng với thiên kiến HTF. Mâu thuẫn = cờ đỏ, ghi chú vào what_price_just_did.
- **PD Arrays:** Chỉ vùng trong ~1–2% so với giá hiện tại. ID: `15M-OB-1`, `5M-FVG-1`.
- **Key Levels:** Chỉ những mức liên quan đến entry, SL, hoặc TP1.
- **Expected Path:** Từng bước điều kiện giá phải hoàn tất trước khi trigger. Mỗi bước có `required_condition`. Mô hình chỉ kích hoạt sau khi hoàn tất TẤT CẢ.
- **Key Events:** Nến BOS/CHoCH, quét, từ chối — ghi giá và thời gian nếu nhìn thấy.

---

## BƯỚC 3 — CHẤM ĐIỂM CHECKLIST

Chấm điểm BUY và SELL độc lập. Dùng điểm cao nhất của từng chiến lược. Gate phải qua trước Bước 4.

**Tính điểm:** High = 3 điểm | Medium = 2 điểm | Low = 1 điểm
`weighted_score = ROUND(điểm_đạt / tổng_điểm × 100)`

**Gate:** `high_weight_passed / high_weight_total ≥ 0.75` → nếu không `trade_plan = []`, dừng.

**passed_items[]:** Chỉ điều kiện đã xác nhận. Cụ thể — tham chiếu ID vùng và giá chính xác.
**failed_critical[]:** Chỉ điều kiện High chưa đạt — kèm giải thích tác động. Lỗi Medium/Low không liệt kê.

### Checklist Tổng Hợp (tất cả chiến lược)

| Trọng số | Danh mục | Điều kiện |
|---|---|---|
| High | Session | London 02:00–05:00 EST hoặc NY 07:00–10:00 EST đang hoạt động |
| High | Structure | D và 4H thiên kiến cùng chiều |
| High | Structure | BOS hoặc CHoCH xác nhận trên 15M (nến đã đóng, body close) |
| High | PD_Arrays | Giá trong vùng discount (mua) hoặc premium (bán) của swing HTF |
| High | Liquidity | DOL xác định — BSL/SSL chưa quét hoặc FVG HTF trong ADR |
| High | Structure | Không có BOS/CHoCH mâu thuẫn trên TF trung gian (1H) |
| Medium | PD_Arrays | Nến displacement trên LTF — động thái mạnh để lại FVG rõ ràng |
| Medium | Confluence | ≥ 2 PD arrays chồng nhau tại vùng vào lệnh |
| Medium | Correlation | DXY 4H thẳng hàng với chiều lệnh (USDCAD) |
| Medium | Correlation | Chiều dầu thô 4H hỗ trợ chiều lệnh (ngược chiều với USDCAD) |
| Medium | Risk | ADR còn lại ≥ 2× khoảng cách SL |
| Medium | Delivery | Delivery giá đến vùng là corrective (ưu tiên) không phải impulsive |
| Medium | Liquidity | Thanh khoản phía lệnh đã bị quét trước khi vào |
| Low | Risk | Không có tin tức tác động lớn trong 30 phút trước entry |
| Low | Structure | Cấu trúc sạch — không choppy/chồng lấp trên 15M |
| Low | Candle | Trigger entry trên nến đã đóng cửa |

---

## BƯỚC 4 — CHỌN MÔ HÌNH VÀO LỆNH

Chỉ sau khi gate qua. `entry_model` phải khớp chính xác tên bên dưới.

### Mô Hình ICT

| Mô hình | Trigger cốt lõi | SL | Quy tắc quan trọng |
|---|---|---|---|
| OB + FVG Confluence | Giá hồi vào OB chứa FVG chưa lấp; nến 15M đóng trong OB với wick từ chối | Dưới đáy OB / trên đỉnh OB + 2–5 pip | BOS xác nhận trước; chỉ trong London hoặc NY session |
| Breaker Block Retest | OB cũ bị phá và đảo vai; giá retest biên vùng Breaker; nến từ chối đóng | Ngoài cực đoan Breaker + 3–5 pip | OB gốc phải đã bị phá VÀ đảo — không chỉ tap |
| Silver Bullet | **Chỉ 10:00–11:00 AM EST.** Displacement tạo FVG 5M/15M; giá hồi; nến 5M đóng trong FVG | Dưới low nến displacement (mua) | Quy tắc thời gian cứng; FVG chưa lấp; không giữ qua đêm |
| Power of 3 (AMD) | Tích lũy Asian xác định; London quét; nến 15M đóng ngược lại vào range | Ngoài điểm sweep + 5 pip | Vào SAU close-back vào range. Không vào trên nến sweep. |
| Judas Swing | London quét giả thanh khoản Asian; CHoCH 15M xác nhận; entry pullback vào OB/FVG 5M mới | Ngoài Judas swing extreme | Vào SAU CHoCH 15M. Không vào trên sweep. |
| CISD | Nến displacement đổi trạng thái delivery; retest vùng body của nến đó | Dưới low nến CISD (mua) | Chỉ retest body — không phải wick |
| Midnight Open Rejection | Giá quét mức 00:00 EST bằng wick; nến từ chối đóng ngược qua | Ngoài wick extreme | Chỉ wick sweep — không phải body đóng qua |

### Mô Hình Price Action

| Mô hình | Trigger cốt lõi | SL | Quy tắc quan trọng |
|---|---|---|---|
| Pin Bar Rejection | Wick >2× body; wick xuyên mức chính; body đóng ra ngoài; vào nến tiếp hoặc 50% body | Ngoài đỉnh wick | Mức phải xác định trước; tỷ lệ wick/body xác nhận |
| Engulfing at Structure | Body hiện tại nuốt hoàn toàn body nến trước tại mức HTF; vào khi đóng | Ngoài low/high nến engulfing | Body engulf — không phải wick-to-wick |
| Inside Bar Breakout | Range trong nến mẹ; vào breakout candle đóng ngoài đỉnh/đáy nến mẹ | Phía đối diện nến mẹ | Nến mẹ = tích lũy; không có vi phạm range trước breakout |
| Fakey (False Breakout) | Inside bar hình thành; giả phá; đảo chiều đóng lại trong range nến mẹ 1–2 nến | Ngoài wick false break | Inside bar phải tồn tại TRƯỚC; nến đảo phải đóng TRONG range mẹ |
| Quasimodo (QM) | HH rồi thất bại HL; tạo LL; entry retest HL cuối (nay là resistance) | Ngoài HH/LL thất bại | ≥ 2 HH/HL hoặc LH/LL trước đó; LL phải xác nhận |
| V-Shape Reversal | Giảm mạnh đột ngột; nến phục hồi đóng trên 50% midpoint trong 1–2 nến | Dưới đáy tuyệt đối | Giảm phải mạnh và đột ngột; phục hồi phải nhanh |

### Mô Hình Market Structure

| Mô hình | Trigger cốt lõi | SL | Quy tắc quan trọng |
|---|---|---|---|
| BOS + Retest | Body đóng qua swing xác nhận BOS; giá retest mức cũ; nến từ chối | Ngoài vùng retest + 3–5 pip | Body close bắt buộc — wick-only không hợp lệ |
| CHoCH Entry | CHoCH đầu tiên sau xu hướng đã thiết lập; pullback LTF vào OB/FVG origin | Dưới CHoCH swing low (mua) | CHoCH ĐẦU TIÊN; xu hướng trước bắt buộc; invalid trong ranging |
| EQH/EQL Sweep + Reverse | ≥2 lần chạm cùng mức; overshoot nhỏ; nến tiếp đóng lại qua EQH/EQL | Ngoài wick extreme | Overshoot phải nhỏ — phá lớn là breakout |
| MSB Confirmation | HTF MSB đã xác nhận; CHoCH 15M cùng chiều; pullback vào OB/FVG LTF mới | Dưới CHoCH swing low LTF (mua) | HTF MSB phải ĐÃ xác nhận — không dự đoán |
| Displacement + Rebalance | FVG rõ ràng từ displacement; entry tại 50% midpoint với từ chối trên 5M | Dưới toàn bộ FVG range (mua) | FVG từ động thái mạnh; gap phải còn mở |

---

## BƯỚC 5 — XÂY DỰNG KẾ HOẠCH GIAO DỊCH

Tất cả phải đúng — nếu không `trade_plan = []`:
- Gate qua (high ≥ 0.75) VÀ `weighted_score ≥ 65`
- Trigger vào lệnh xác định được ngay hoặc sắp tới
- `risk_reward ≥ 2`
- ADR còn lại ≥ 2× khoảng cách SL
- Không có cấu trúc HTF mâu thuẫn chưa giải quyết

**Entry:** Vùng PD array LTF (OB top/bottom; 50% midpoint FVG)
**SL:** Ngoài cực đoan vùng + buffer. Không đặt trong vùng.
**TP1:** Thanh khoản LTF gần nhất (EQH/EQL, PDH/PDL) trong ADR
**TP2:** ID reference zone HTF từ htf_context
**TP3:** ID mục tiêu DOL HTF từ htf_context

**Tỷ lệ chốt:** TP1 = 50% | TP2 = 30% | TP3 = 20%
**Breakeven:** Dời SL về entry sau khi TP1 chạm.

**Loại lệnh:**
- `Limit` → giá chưa đến vùng (mặc định)
- `Stop Limit` → cần nến xác nhận breakout đóng trước
- `Market` → estimate_candles = 0 VÀ limit sẽ bỏ lỡ lệnh

**Xếp loại và rủi ro:**

| Grade | Điều kiện | Risk |
|---|---|---|
| A | Score ≥ 85 · Tất cả High đạt · RR ≥ 3 | 1.0% |
| B | Score 65–84 · Gate qua · RR ≥ 2 | 0.5% |
| C | Score 50–64 · RR biên giới | 0.25% |
| NoTrade | Score < 50 · Gate thất bại · RR < 2 | — |

---

## QUY TẮC CHUNG
- Phân tích HTF → LTF. Không đảo ngược.
- Tối đa 2 kế hoạch giao dịch. Sắp xếp giảm dần theo `confidence_pct`.
- Không đồng thời tạo BUY và SELL trừ khi cả hai qua gate độc lập.
- ID PD array nhất quán trong ltf_analysis, checklist và trade_plan.
- Mọi TP2/TP3 `reference` phải chứa ID thực từ `htf_context.reference_zones[].id`.
- Dùng `""` khi bằng chứng yếu — không bịa đặt narrative.
- Trả về JSON thuần túy — không markdown, không prose ngoài JSON.

**Giới hạn schema (v2.3):** tối đa 2 trade plans · 6 PD arrays · 6 key levels · 6 reference zones · 8 key events · 5 expected path steps
