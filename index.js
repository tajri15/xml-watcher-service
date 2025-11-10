const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WATCH_PATH = 'Z:\\62001DS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';

console.log('--- XML Watcher Service ---');
console.log(`[INFO] Service dimulai...`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log('---------------------------');
