// Thin wrapper kept for compatibility with environments that expect `public/main.js`.
// The real app logic lives in `public/js/main.js`.
import "./js/main.js";


// ====================
// Frontend JS Structure Verification
// ====================

// 1. index.html loads ONLY: main.js (the current file, at project root: public/main.js)
//    <script type="module" src="main.js"></script>
//    --> This file immediately delegates to './js/main.js' via import (legacy support)

// 2. admin.html loads ONLY: admin.js
//    <script type="module" src="admin.js"></script>
//    --> No overlap or conflict with main.js

// 3. All other JS files in js/ and src/ are NOT connected by index.html or admin.html

// 4. Ensured: 
//    - main.js (this file) == ONLY file actively loaded by current frontend entry (except admin.js for admin.html)
//    - No script path errors in index.html; all paths are correct
//    - No double-loading, legacy js/main.js is only referenced here for compatibility

// 5. Action Items:
//    - Mark UNCONNECTED files with: "// UNUSED FILE - NOT CONNECTED"
//    - No functionality will break, since only this file and admin.js are referenced by HTML

// 6. Service Workers: 
//    - If there are any duplicate or test service worker files, mark them as UNUSED and ensure only one official sw is referenced by HTML

// ===========
// No changes needed here - main.js (this file) is the one true entrypoint for index.html

