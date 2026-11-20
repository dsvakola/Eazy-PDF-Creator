Eazy PDF Creator  -  Build Instructions (Windows 10/11)
======================================================
Developed by: Prof. Dattaraj S. Vidyasagar & Prof. Yash D. Vidyasagar
Publisher:    Vidyasagar Academy (https://www.vsa.edu.in)
Repository:   https://github.com/dsvakola/Eazy-PDF-Creator

Requirements:
- Node.js LTS (https://nodejs.org)
- pnpm (run: npm install -g pnpm)

Commands:
1. Install dependencies:  pnpm install
2. Run in dev mode:       pnpm start
3. Build executables:     pnpm run dist
   Produces both Portable (.exe) and Setup Installer (.exe) in the "release" folder.
4. Build for MS Store:    pnpm run dist:appx
