# Eazy PDF Creator

<p align="center">
  <img src="assets/logo.png" width="128" height="128" alt="Eazy PDF Creator Logo">
</p>

**Eazy PDF Creator** is a fast, modern, and 100% lossless desktop PDF Creator, Viewer, and Editor developed by **Prof. Dattaraj S. Vidyasagar** and **Prof. Yash D. Vidyasagar** for **Vidyasagar Academy**.

---

## 🌟 Key Features

### 1. 🔄 100% Lossless PDF Creation & Merging
- **Native Vector Stream Copying**: Existing PDF pages, vector glyphs, and TrueType fonts are copied directly without rasterization or blurriness.
- **Direct Image Embedding**: JPG images are embedded directly via `/DCTDecode` with **zero re-compression**. PNG images are embedded losslessly via `/FlateDecode`.
- **Multi-File Queue**: Drag and drop multiple PDFs and images (JPG, PNG, WebP, BMP, GIF).
- **Page Ranges & Rotation**: Specify custom page ranges (e.g. `1-5, 8, 10-end`) and rotate individual pages before creating.

### 2. 🔒 Comprehensive Security & Protection (Enterprise Grade)
- **Create password for opening**: Restrict opening to authorized users.
- **Lock printing**: Prevent unauthorized printing.
- **Lock copying**: Protect content from being selected or copied.
- **Lock modifying**: Prevent content tampering or page edits.
- Standard RC4-128 permissions encryption compatible with all PDF viewers.

### 3. 📖 Professional Viewer & Editor
- Multi-tab viewing, thumbnail sidebar, table of contents outline, notes panel.
- Text search with match counter and live highlighting.
- Highlighting (multiple colors), underlining, sticky notes.
- Presentation / fullscreen mode (F5).
- 3 built-in reading themes: Light, Dark, Sepia.

### 4. 🛡️ 100% Offline & Private
- Completely offline local processing. Zero telemetry, zero analytics, zero network uploads.
- Read our [Privacy Policy](PRIVACY-POLICY.md).

---

## 💻 Developers & Publisher
- **Developers**: Prof. Dattaraj S. Vidyasagar & Prof. Yash D. Vidyasagar
- **Publisher**: Vidyasagar Academy ([www.vsa.edu.in](https://www.vsa.edu.in))
- **License**: GNU General Public License v3.0 ([LICENSE.txt](LICENSE.txt))

---

## 🛠️ Build from Source

Requirements:
- [Node.js](https://nodejs.org) (LTS)
- [pnpm](https://pnpm.io) (`npm install -g pnpm`)

```powershell
# 1. Install dependencies
pnpm install

# 2. Run in development mode
pnpm start

# 3. Build standalone Portable (.exe) and Setup Installer (.exe)
pnpm run dist
```
Output executables will be generated in `release/`:
- `Eazy PDF Creator Portable 1.2.0.exe`
- `Eazy PDF Creator Setup 1.2.0.exe`
