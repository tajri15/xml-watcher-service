const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Parser } = require('xml2js');

// --- KONFIGURASI ---
const WATCH_PATH = 'D:\\Image\\62001FS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';
const WAIT_TIME_MS = 60000;
// -------------------

console.log('--- XML Watcher Service ---');
console.log(`[INFO] Service dimulai...`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log('---------------------------');

/**
 * Fungsi untuk mendeteksi dan mengkonversi encoding file
 */
const detectAndConvertEncoding = (buffer) => {
  // Deteksi UTF-16 Little Endian (BOM: FF FE)
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    console.log(`[ENCODING] Detected: UTF-16 Little Endian`);
    // Hapus BOM dan konversi ke string UTF-16 LE
    const content = buffer.slice(2).toString('utf16le');
    return content;
  }
  
  // Deteksi UTF-16 Big Endian (BOM: FE FF)
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    console.log(`[ENCODING] Detected: UTF-16 Big Endian`);
    const content = buffer.slice(2).toString('utf16be');
    return content;
  }
  
  // Deteksi UTF-8 BOM (EF BB BF)
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    console.log(`[ENCODING] Detected: UTF-8 with BOM`);
    const content = buffer.slice(3).toString('utf8');
    return content;
  }
  
  // Default: coba UTF-8
  console.log(`[ENCODING] Default: Using UTF-8`);
  return buffer.toString('utf8');
};

/**
 * Fungsi untuk membersihkan dan memvalidasi XML content
 */
const cleanAndValidateXml = (content) => {
  // Trim whitespace
  let cleaned = content.trim();
  
  // Hapus encoding declaration UTF-16, ganti dengan UTF-8
  // Karena server mungkin tidak support UTF-16
  cleaned = cleaned.replace(/encoding="UTF-16"/gi, 'encoding="UTF-8"');
  
  // Pastikan dimulai dengan <
  if (!cleaned.startsWith('<')) {
    const firstTagIndex = cleaned.indexOf('<');
    if (firstTagIndex > 0) {
      console.log(`[CLEAN] Removing ${firstTagIndex} characters before first tag`);
      cleaned = cleaned.slice(firstTagIndex);
    }
  }
  
  return cleaned;
};

/**
 * Fungsi untuk memvalidasi struktur XML sesuai kebutuhan server
 */
const validateXmlStructure = (xmlContent) => {
  const issues = [];
  
  // Cek tag required berdasarkan Transmission.log
  if (!xmlContent.includes('<IDR>')) {
    issues.push('Missing <IDR> tag');
  }
  
  if (!xmlContent.includes('<IDR_IMAGE>')) {
    issues.push('Missing <IDR_IMAGE> tag');
  }
  
  if (!xmlContent.includes('<PICNO>')) {
    issues.push('Missing <PICNO> tag');
  }
  
  if (!xmlContent.includes('<IDR_CHECK_UNIT>')) {
    issues.push('Missing <IDR_CHECK_UNIT> tag');
  }
  
  // Cek container data
  if (!xmlContent.includes('<container_no>') && !xmlContent.includes('DRYU')) {
    issues.push('Missing container number data');
  }
  
  return issues;
};

/**
 * Fungsi untuk mendapatkan ftp_path dari file path
 */
const getFtpPath = (filePath) => {
  try {
    const relativePath = path.dirname(path.relative(WATCH_PATH, filePath));
    return `/import/62001FS03/${relativePath.replace(/\\/g, '/')}/`;
  } catch (error) {
    console.log(`[WARNING] Gagal generate ftp_path, menggunakan default`);
    return '/import/62001FS03/';
  }
};

/**
 * Fungsi untuk membaca file XML dengan deteksi encoding
 */
const readXmlFileWithEncoding = (filePath) => {
  try {
    // Baca sebagai buffer
    const fileBuffer = fs.readFileSync(filePath);
    console.log(`[READ] File size: ${fileBuffer.length} bytes`);
    
    // Debug: tampilkan byte pertama
    console.log(`[DEBUG] First 10 bytes (hex): ${Array.from(fileBuffer.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // Deteksi dan konversi encoding
    const xmlContent = detectAndConvertEncoding(fileBuffer);
    
    // Bersihkan dan validasi
    const cleanedContent = cleanAndValidateXml(xmlContent);
    
    console.log(`[READ] Success, length: ${cleanedContent.length} characters`);
    console.log(`[DEBUG] First 200 chars: ${cleanedContent.substring(0, 200).replace(/\n/g, '\\n')}`);
    
    return cleanedContent;
    
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
};

/**
 * Fungsi untuk menganalisis konten XML
 */
const analyzeXmlContent = (xmlContent) => {
  console.log(`[ANALYSIS] Analyzing XML content...`);
  
  // Validasi struktur
  const structureIssues = validateXmlStructure(xmlContent);
  if (structureIssues.length > 0) {
    console.log(`[ANALYSIS] Structure issues: ${structureIssues.join(', ')}`);
  } else {
    console.log(`[ANALYSIS] Basic structure OK`);
  }
  
  // Cek PICNO
  const picnoMatch = xmlContent.match(/<PICNO>([^<]+)<\/PICNO>/);
  if (picnoMatch) {
    console.log(`[ANALYSIS] PICNO: ${picnoMatch[1]}`);
  } else {
    console.log(`[ANALYSIS] PICNO: Not found`);
  }
  
  // Cek container number
  const containerMatch = xmlContent.match(/<container_no>([^<]+)<\/container_no>/);
  if (containerMatch) {
    console.log(`[ANALYSIS] Container No: ${containerMatch[1]}`);
  } else {
    console.log(`[ANALYSIS] Container No: Not found (this might be the problem)`);
  }
  
  // Cek SCANTIME
  const scanTimeMatch = xmlContent.match(/<SCANTIME>([^<]+)<\/SCANTIME>/);
  if (scanTimeMatch) {
    console.log(`[ANALYSIS] SCANTIME: ${scanTimeMatch[1]}`);
  }
  
  return {
    hasPicno: !!picnoMatch,
    hasContainer: !!containerMatch,
    picno: picnoMatch ? picnoMatch[1] : null,
    container: containerMatch ? containerMatch[1] : null,
    issues: structureIssues
  };
};

/**
 * Fungsi untuk memproses dan mengirim file XML
 */
const sendXmlFile = async (filePath) => {
  let xmlContent = '';
  
  try {
    console.log(`\n[PROSES] Memproses file: ${path.basename(filePath)}`);
    
    // 1. Baca file dengan deteksi encoding
    xmlContent = readXmlFileWithEncoding(filePath);
    
    // 2. Analisis konten XML
    const analysis = analyzeXmlContent(xmlContent);
    
    // 3. Jika tidak ada container number, ini mungkin masalah utama
    if (!analysis.hasContainer) {
      console.log(`[WARNING] ⚠️  XML tidak mengandung container number!`);
      console.log(`[WARNING] Ini mungkin penyebab error "Container Tidak Terbaca"`);
    }
    
    // 4. Coba parsing untuk validasi syntax
    try {
      const parser = new Parser({ 
        explicitRoot: true,
        explicitArray: false,
        mergeAttrs: true,
        trim: true
      });
      const result = await parser.parseStringPromise(xmlContent);
      console.log(`[VALIDASI] XML syntax valid`);
    } catch (parseError) {
      console.warn(`[WARNING] XML parsing failed: ${parseError.message}`);
    }
    
    // 5. Siapkan payload
    const ftpPath = getFtpPath(filePath);
    const payload = {
      ftp_path: ftpPath,
      image_msg: xmlContent
    };

    console.log(`[PAYLOAD] ftp_path: ${ftpPath}`);
    console.log(`[PAYLOAD] Sending ${xmlContent.length} characters`);

    // 6. Kirim ke server
    console.log(`[MENGIRIM] Sending to server...`);
    
    const response = await axios.post(POST_URL, payload, { 
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }, 
      timeout: 30000 
    });

    // 7. Handle response
    console.log(`[SUKSES] HTTP Status: ${response.status}`);
    
    if (response.data && response.data.resultCode === true) {
      console.log(`[SERVER] ✅ SUCCESS: ${response.data.resultDesc || 'No description'}`);
      if (response.data.resultData) {
        console.log(`[SERVER] Data: ${JSON.stringify(response.data.resultData)}`);
      }
    } else {
      console.log(`[SERVER] ❌ FAILED: ${response.data?.resultDesc || 'Unknown error'}`);
      
      // Berikan saran berdasarkan error message
      if (response.data?.resultDesc?.includes('Container Tidak Terbaca')) {
        console.log(`[SOLUSI] 💡 Problem: Container number missing or invalid in XML`);
        console.log(`[SOLUSI] 💡 Check if <container_no> tag exists with valid data`);
      }
      
      if (response.data?.resultDesc?.includes('Format Input Parameter')) {
        console.log(`[SOLUSI] 💡 Problem: XML structure or content format issue`);
        console.log(`[SOLUSI] 💡 Verify XML against working examples from Transmission.log`);
      }
    }
    
    return response.data?.resultCode === true;
    
  } catch (error) {
    if (error.response) {
      console.error(`[GAGAL] Server error: ${error.response.status}`);
      console.error(`[SERVER] Response: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`[GAGAL] Connection error: ${error.message}`);
    } else {
      console.error(`[GAGAL] Processing error: ${error.message}`);
    }
    
    return false;
  }
};

// Inisialisasi watcher
const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,      
  ignoreInitial: true,   
  recursive: true,       
  usePolling: true, 
  interval: 3000,
  ignored: /(^|[/\\])\../
});

// Map untuk melacak timer yang aktif
const activeTimers = new Map();

// Event listener untuk file baru ('add')
watcher.on('add', (filePath) => {
  if (path.extname(filePath).toLowerCase() === '.xml') {
    const fileName = path.basename(filePath);
    
    // Hapus timer sebelumnya jika ada untuk file yang sama
    if (activeTimers.has(filePath)) {
      clearTimeout(activeTimers.get(filePath));
      activeTimers.delete(filePath);
    }
    
    console.log(`\n[DETEKSI] File XML baru: ${fileName}`);
    console.log(`[INFO] Menunggu ${WAIT_TIME_MS / 1000} detik...`);

    // Set timer baru
    const timer = setTimeout(async () => {
      console.log(`[PROSES] Waktu tunggu selesai. Memproses ${fileName}...`);
      activeTimers.delete(filePath);
      
      try {
        const stats = fs.statSync(filePath);
        console.log(`[INFO] File size: ${stats.size} bytes`);
        
        if (stats.size === 0) {
          console.error(`[GAGAL] File ${fileName} kosong (0 bytes)`);
          return;
        }
        
        await sendXmlFile(filePath);
      } catch (statsError) {
        console.error(`[GAGAL] Tidak bisa mengakses file: ${statsError.message}`);
      }
    }, WAIT_TIME_MS);
    
    activeTimers.set(filePath, timer);
  }
});

// Event listener untuk error pada watcher
watcher.on('error', (error) => {
  console.error(`[ERROR WATCHER] Terjadi kesalahan: ${error}`);
});

// Cleanup timer saat proses dihentikan
process.on('SIGINT', () => {
  console.log('\n[INFO] Menghentikan service...');
  activeTimers.forEach((timer, filePath) => {
    clearTimeout(timer);
  });
  watcher.close();
  process.exit(0);
});

console.log(`[INFO] Watcher berhasil dijalankan. Menunggu file XML baru...`);