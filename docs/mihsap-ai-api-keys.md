# Mihsap AI API Key Kurulumu

Mihsap fatura isleyici varsayilan olarak `shadow` modda calisir. Bu modda ucuz sistem denenir ama karar yine Claude'dan doner. API key yoksa yeni katman hic devreye girmez ve mevcut Claude akisi bozulmaz.

## Gerekli Key'ler

- `MISTRAL_API_KEY`: Fatura gorselinden/PDF'den ucuz OCR metni cikarmak icin.
  - Mistral Console > Workspace > API keys > Create new key.
  - Billing/Payment aktif olmalidir.
  - Kaynak: https://docs.mistral.ai/admin/security-access/api-keys

- `GEMINI_API_KEY`: OCR metninden ucuz karar uretmek icin ana model.
  - Google AI Studio veya Google Cloud Console uzerinden API key olusturulur.
  - Billing ve kota/budget uyarilari aktif edilmelidir.
  - Kaynak: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys

- `OPENAI_API_KEY`: Gemini yoksa veya hata verirse yedek karar modeli.
  - OpenAI Platform > API keys sayfasindan secret key olusturulur.
  - Kaynak: https://help.openai.com/en/articles/4936850-how-to-create-and-use-an-api-key

- `AZURE_VISION_KEY` ve `AZURE_VISION_ENDPOINT`: Mistral yoksa mevcut Azure OCR yedegi.
  - Azure Portal'da Azure AI Vision / Computer Vision resource acilir.
  - Resource icindeki Keys and Endpoint bolumunden alinir.
  - Kaynak: https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/quickstarts-sdk/image-analysis-client-library

## Railway Variables

Backend servisinde Railway > Variables:

```env
MIHSAP_DECISION_MODE=shadow
MIHSAP_OCR_PROVIDER=auto
MIHSAP_CHEAP_MODEL_PROVIDER=auto
MIHSAP_MIN_CONFIDENCE=0.82
MISTRAL_API_KEY=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
AZURE_VISION_KEY=...
AZURE_VISION_ENDPOINT=...
```

Ilk deploy icin `MIHSAP_DECISION_MODE=shadow` kalmali. Gercek kullanimda fark loglari temizse `balanced` yapilir.

## Guvenlik

- API key'leri sohbete, GitHub'a veya `.env.example` icine yazma.
- Key'leri sadece Railway Variables gibi secret alanlarda tut.
- Her provider icin harcama limiti/budget alarmi ac.
- Bir key sizardan suphelenilirse hemen revoke/delete edip yenisini olustur.
