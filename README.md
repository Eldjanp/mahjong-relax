# Mahjong Relax

Lojë Mahjong Solitaire për Android me pllaka të mëdha dhe ndërfaqe të thjeshtë.

## Veçoritë
- Pllaka të mëdha, të lexueshme, me numra në qoshe (mund të fiken)
- Nivele pa fund që vështirësohen gradualisht; çdo nivel garantohet të ketë zgjidhje
- Sfida ditore me kalendar dhe trofe
- Ndihmë 💡, përzierje 🔀 dhe kthim mbrapa ↶; monedha për të blerë më shumë
- Errësim i pllakave të bllokuara, 5 sfonde, zë dhe dridhje
- Loja ruhet automatikisht; funksionon pa internet

## APK
Çdo `push` ndërton automatikisht APK-në me GitHub Actions. Shkarkoje nga faqja **Releases**.

## Ndërtim lokal
```bash
npm ci
npx cap sync android
cd android && ./gradlew assembleRelease
```
