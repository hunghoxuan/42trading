# POS camera recognition and search

## Shared camera

Barcode scanning and product recognition both use `PhotoCamera` and the existing `MobileFullscreenModal`. The camera is a centered modal on desktop and fills the viewport on mobile (up to 767 px). Both modes automatically capture a steady image and provide **Scan now**, camera selection, optional camera light, and existing-photo upload. Barcode captures preserve the full frame; product photos use the displayed square crop.

A successful barcode decode closes the modal and shows the actual code and inventory lookup result. A failed capture retains the photo with a clear retry message. Closing or switching the camera releases the stream. Barcode decoding uses the native browser detector when available and ZXing with `TRY_HARDER`, close-ups, rotation and contrast views. Scanner screenshots and uploaded images use the same decoder.

## Product recognition

An exact locally decoded barcode is tried first. Otherwise POS recognition uses this server-side fallback order:

1. **Codex OpenAI-compatible wrapper**, when `CODEX_OPENAI_BASE_URL` is configured, using the multimodal `/chat/completions` protocol. If the wrapper is unavailable or unset, POS falls back to the local Codex CLI login in a temporary directory with the read-only sandbox. `CODEX_OPENAI_API_KEY` and `CODEX_OPENAI_MODEL` are optional wrapper settings.
2. **Google Gemini**, using the signed-in user's Gemini key from Settings > Providers or `GEMINI_API_KEY`, `GOOGLE_GEMINI_API_KEY`, or `GOOGLE_API_KEY` from the server environment. `POS_PRODUCT_AI_MODEL` selects its model.
3. **OpenAI-compatible API**, using the signed-in user's OpenAI key from Settings > Providers or `OPENAI_API_KEY`. To use a ChatGPT Web wrapper, set `CHATGPT_WEB_OPENAI_BASE_URL` to its OpenAI-compatible base URL and optionally set `CHATGPT_WEB_OPENAI_MODEL` and `CHATGPT_WEB_OPENAI_API_KEY`. Without that URL, this step uses the official OpenAI API; it does not connect to ChatGPT Web automatically.
4. **Local Ollama**, using `POS_OLLAMA_VISION_MODEL` or `qwen2.5vl:3b` at `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`). It requires Ollama and the model installed locally and uses no API key.

The next provider is tried when the previous provider is unavailable or returns an invalid product observation. Provider keys stay on the server. The image is sent to whichever provider handles the request; POS does not save it as an entity during recognition. This does not change the cash-recognition provider configuration.

`POST /api/pos/images/recognize` accepts `{ image: dataURL }` and receives the authenticated actor. It returns:

- `observed`: object description, readable product name, brand, variant, size, barcode, transcribed `texts`, colors, and `visible_price`.
- `candidates`: products from inventory that pass deterministic identity matching.
- `keywords`, `colors`, and `recognized_text` for review.

The model must return structured JSON, ground identity in readable label text, and mark unclear/non-product/multiple-product photos accordingly. Missing or malformed provider responses fail explicitly; the production endpoint does not fall back to the old OCR/color matcher. See [Google image understanding](https://ai.google.dev/gemini-api/docs/image-understanding) and [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

Matching normalizes Vietnamese accents and common product-type terms. It requires a supported brand or multiple distinctive name words, substantial product-name coverage, and no conflicting readable variant/size. Equivalent mass/volume units are normalized. A readable barcode absent from inventory does not trigger substitute suggestions. Color, generic object names, weak OCR words, and arbitrary OR results cannot create suggestions.

The UI displays only the matched IDs after recognition, including an empty list when no item qualifies. Manual keyword search still splits spaces, `OR`, `|`, commas, and semicolons into alternatives, ignores accents, and ranks stronger matches first. **Clear recognition** restores the catalog.

## Prices

`visible_price` is null unless an actual selling price is transcribed from the image. Savings claims, unreadable amounts, and remembered/estimated prices are excluded. The UI labels image prices separately. Register prices always come from inventory; recognition never changes a price or automatically adds an AI guess to the cart.

## Verification

The existing POS tests cover strict Lifebuoy/Choco Bar separation, unclear/non-product/unknown identities, variants, size conflicts and equivalent units, authenticated AI calls, malformed/provider failures, inventory-price separation and savings-label rejection. Legacy OCR tests remain for that isolated helper, which is no longer used by the product-recognition endpoint.
