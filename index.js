const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const WATCH_PATH = 'D:\\Image\\62001FS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';
const WAIT_TIME_MS = 60000;
const DEVICE_NO = '62001FS03';
const IMAGE_SERVER_BASE = 'http://192.111.111.80:6688';

console.log('╔════════════════════════════════════════════════════╗');
console.log('║             XML Watcher Service - IMPORT           ║');
console.log('║          (Dengan Perbaikan Split Container)        ║');
console.log('╚════════════════════════════════════════════════════╝');
console.log(`[INFO] Service dimulai pada: ${new Date().toLocaleString('id-ID')}`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log(`[INFO] Device: ${DEVICE_NO}`);
console.log(`[INFO] Image Server: ${IMAGE_SERVER_BASE}`);
console.log(`[INFO] Wait time: ${WAIT_TIME_MS / 1000} detik`);
console.log('═'.repeat(60));

// ============================================================
// FUNGSI VALIDASI STRUKTUR SPLIT CONTAINER
// ============================================================
const validateSplitContainerStructure = (xmlContent, splitFolder) => {
  console.log(`[VALIDATION] 🔍 Validasi struktur split container ${splitFolder}...`);
  
  const issues = [];
  const warnings = [];
  
  // 1. Cek PICNO mengandung suffix split folder
  const picnoMatch = xmlContent.match(/<PICNO>([^<]+)<\/PICNO>/);
  if (picnoMatch) {
    const picno = picnoMatch[1];
    if (splitFolder && !picno.endsWith(splitFolder)) {
      issues.push(`PICNO (${picno}) tidak berakhiran dengan split folder (${splitFolder})`);
    } else if (splitFolder && picno.endsWith(splitFolder)) {
      console.log(`[VALIDATION] ✅ PICNO konsisten: ${picno}`);
    }
  }
  
  // 2. Cek PATH mengandung subfolder split
  const pathMatch = xmlContent.match(/<PATH>([^<]+)<\/PATH>/);
  if (pathMatch) {
    const path = pathMatch[1];
    if (splitFolder && !path.includes(`/${splitFolder}`)) {
      issues.push(`PATH (${path}) tidak mengandung subfolder ${splitFolder}`);
    } else if (splitFolder && path.includes(`/${splitFolder}`)) {
      console.log(`[VALIDATION] ✅ PATH konsisten: ${path}`);
    }
  }
  
  // 3. Cek IMGTYPE URLs
  const imgtypeMatch = xmlContent.match(/<IMGTYPE>([\s\S]*?)<\/IMGTYPE>/);
  if (imgtypeMatch && imgtypeMatch[1]) {
    const imgtypeData = imgtypeMatch[1];
    const imageUrls = imgtypeData.match(/http:\/\/[^\s<>"]+\.(?:jpg|img|_icon\.jpg)/gi) || [];
    
    console.log(`[VALIDATION] Found ${imageUrls.length} image URLs in IMGTYPE`);
    
    if (splitFolder) {
      const urlsWithSplitFolder = imageUrls.filter(url => url.includes(`/${splitFolder}/`));
      const urlsWithoutSplitFolder = imageUrls.filter(url => !url.includes(`/${splitFolder}/`));
      
      if (urlsWithSplitFolder.length > 0) {
        console.log(`[VALIDATION] ✅ ${urlsWithSplitFolder.length} URL mengarah ke subfolder ${splitFolder}`);
      }
      
      if (urlsWithoutSplitFolder.length > 0) {
        warnings.push(`${urlsWithoutSplitFolder.length} URL tidak mengandung subfolder ${splitFolder}`);
        console.log(`[VALIDATION] ⚠️  URLs tanpa subfolder ${splitFolder}:`);
        urlsWithoutSplitFolder.forEach((url, i) => console.log(`   ${i+1}. ${url}`));
      }
    }
  }
  
  // 4. Cek IDR_SII_SCANIMG entries
  const scanImgRegex = /<IDR_SII_SCANIMG>[\s\S]*?<PATH>([^<]+)<\/PATH>[\s\S]*?<\/IDR_SII_SCANIMG>/g;
  const scanImgPaths = [];
  let match;
  
  while ((match = scanImgRegex.exec(xmlContent)) !== null) {
    scanImgPaths.push(match[1]);
  }
  
  if (splitFolder && scanImgPaths.length > 0) {
    const scanImgsWithSplitFolder = scanImgPaths.filter(p => p.includes(`/${splitFolder}/`));
    const scanImgsWithoutSplitFolder = scanImgPaths.filter(p => !p.includes(`/${splitFolder}/`));
    
    if (scanImgsWithSplitFolder.length > 0) {
      console.log(`[VALIDATION] ✅ ${scanImgsWithSplitFolder.length} SCANIMG paths mengarah ke subfolder ${splitFolder}`);
    }
    
    if (scanImgsWithoutSplitFolder.length > 0) {
      warnings.push(`${scanImgsWithoutSplitFolder.length} SCANIMG paths tidak mengandung subfolder ${splitFolder}`);
    }
  }
  
  if (issues.length === 0 && warnings.length === 0) {
    console.log(`[VALIDATION] ✅ Validasi split container ${splitFolder} BERHASIL`);
    return { valid: true, issues: [], warnings: [] };
  } else {
    console.log(`[VALIDATION] ⚠️  Hasil validasi split container:`);
    issues.forEach(issue => console.log(`   ❌ ${issue}`));
    warnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
    return { 
      valid: issues.length === 0, 
      issues: issues, 
      warnings: warnings 
    };
  }
};

// ============================================================
// FUNGSI UNTUK MENDAPATKAN SPLIT FOLDER DARI PATH
// ============================================================
const getSplitFolderFromPath = (pathStr) => {
  if (!pathStr) return null;
  
  // Pattern untuk mendeteksi folder 001, 002, 003, etc.
  const splitFolderMatch = pathStr.match(/\/(\d{3})\/?$/);
  return splitFolderMatch ? splitFolderMatch[1] : null;
};

// ============================================================
// FUNGSI UNTUK MEMPERBAIKI URL GAMBAR DI IMGTYPE
// ============================================================
const fixImageUrlsForSplitContainer = (imgtypeData, splitFolder, basePath) => {
  console.log(`[URL-FIX] 🔧 Memperbaiki URL gambar untuk split container ${splitFolder}...`);
  
  if (!imgtypeData || !splitFolder) {
    console.log(`[URL-FIX] ❌ Tidak ada data atau split folder`);
    return imgtypeData;
  }
  
  // Pattern 1: Deteksi URL dengan format lengkap
  // http://192.111.111.80:6688/62001FS03/2025/1118/0674/62001FS03202511180674.jpg
  const fullUrlPattern = /(http:\/\/192\.111\.111\.80:6688)(\/62001FS\d\d\/\d{4}\/\d{4}\/\d{4}\/)([^\/<>"\s]+\.(?:jpg|img|_icon\.jpg))/gi;
  
  // Pattern 2: Deteksi URL relatif dalam CDATA
  const relativeUrlPattern = /(&lt;img&gt;)(http:\/\/192\.111\.111\.80:6688)(\/62001FS\d\d\/\d{4}\/\d{4}\/\d{4}\/)([^\/<>"\s]+\.(?:jpg|img|_icon\.jpg))(&lt;\/img&gt;)/gi;
  
  let fixedData = imgtypeData;
  let fixCount = 0;
  
  // Perbaiki URL lengkap
  fixedData = fixedData.replace(fullUrlPattern, (match, protocol, folderPath, filename) => {
    fixCount++;
    // Hapus trailing slash jika ada
    const cleanFolderPath = folderPath.replace(/\/$/, '');
    const newUrl = `${protocol}${cleanFolderPath}/${splitFolder}/${filename}`;
    console.log(`[URL-FIX]   🔄 ${match}`);
    console.log(`[URL-FIX]       → ${newUrl}`);
    return newUrl;
  });
  
  // Perbaiki URL dalam tag &lt;img&gt;
  fixedData = fixedData.replace(relativeUrlPattern, (match, openTag, protocol, folderPath, filename, closeTag) => {
    fixCount++;
    // Hapus trailing slash jika ada
    const cleanFolderPath = folderPath.replace(/\/$/, '');
    const newUrl = `${openTag}${protocol}${cleanFolderPath}/${splitFolder}/${filename}${closeTag}`;
    return newUrl;
  });
  
  console.log(`[URL-FIX] ✅ Diperbaiki ${fixCount} URL gambar`);
  
  // Verifikasi hasil
  const imageUrls = fixedData.match(/http:\/\/192\.111\.111\.80:6688[^\s<>"]+\.(?:jpg|img|_icon\.jpg)/gi) || [];
  const urlsWithSplitFolder = imageUrls.filter(url => url.includes(`/${splitFolder}/`));
  
  console.log(`[URL-FIX] 📊 Hasil:`);
  console.log(`   - Total URLs: ${imageUrls.length}`);
  console.log(`   - URLs dengan /${splitFolder}/: ${urlsWithSplitFolder.length}`);
  console.log(`   - URLs tanpa /${splitFolder}/: ${imageUrls.length - urlsWithSplitFolder.length}`);
  
  if (urlsWithSplitFolder.length === 0 && imageUrls.length > 0) {
    console.log(`[URL-FIX] ⚠️  PERINGATAN: Tidak ada URL yang mengandung subfolder ${splitFolder}!`);
  }
  
  return fixedData;
};

// ============================================================
// FUNGSI MEMBACA DAN VALIDASI XML
// ============================================================
const readAndValidateXml = (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    console.log(`[READ] File size: ${fileBuffer.length} bytes`);
    
    let xmlContent;
    
    // Deteksi encoding
    if (fileBuffer[0] === 0xFF && fileBuffer[1] === 0xFE) {
      console.log(`[ENCODING] UTF-16 LE detected, converting to UTF-8...`);
      xmlContent = fileBuffer.slice(2).toString('utf16le');
      xmlContent = xmlContent.replace(/encoding="UTF-16"/gi, 'encoding="UTF-8"');
    } else {
      xmlContent = fileBuffer.toString('utf8');
    }
    
    // Deteksi tipe XML
    const hasIDRImage = xmlContent.includes('<IDR_IMAGE>');
    const hasPICNO = xmlContent.includes('<PICNO>');
    const hasIDRCheckUnit = xmlContent.includes('<IDR_CHECK_UNIT>');
    const isSubmittedXML = xmlContent.includes('<IDR_SII_SCANIMG>');
    const isInitialXML = xmlContent.includes('<SCANIMG>') && !xmlContent.includes('<IDR_SII_SCANIMG>');
    
    // Deteksi split container dari PATH
    const pathMatch = xmlContent.match(/<PATH>([^<]+)<\/PATH>/);
    const splitFolder = pathMatch ? getSplitFolderFromPath(pathMatch[1]) : null;
    
    console.log(`[VALIDATION] Tipe XML: ${isSubmittedXML ? 'SUBMITTED' : isInitialXML ? 'INITIAL' : 'UNKNOWN'}`);
    console.log(`[VALIDATION] Tipe Container: ${splitFolder ? `SPLIT (${splitFolder})` : 'NORMAL'}`);
    console.log(`[VALIDATION] Has IDR_IMAGE: ${hasIDRImage ? '✅' : '❌'}`);
    console.log(`[VALIDATION] Has PICNO: ${hasPICNO ? '✅' : '❌'}`);
    console.log(`[VALIDATION] Has IDR_CHECK_UNIT: ${hasIDRCheckUnit ? '✅' : '❌'}`);
    
    const isValid = hasIDRImage && hasPICNO && hasIDRCheckUnit;
    
    return {
      content: xmlContent,
      isValid: isValid,
      isSubmittedXML: isSubmittedXML,
      isInitialXML: isInitialXML,
      splitFolder: splitFolder,
      originalPath: pathMatch ? pathMatch[1] : ''
    };
    
  } catch (error) {
    throw new Error(`Gagal membaca file: ${error.message}`);
  }
};

// ============================================================
// FUNGSI TRANSFORMASI XML UNTUK SPLIT CONTAINER
// ============================================================
const transformSubmittedXML = (xmlContent, picno, originalFilePath) => {
  console.log(`[TRANSFORM] 🔄 Mengonversi XML untuk pengiriman...`);
  
  // Ekstrak data dari XML
  const idMatch = xmlContent.match(/<ID>\{?([A-F0-9-]+)\}?<\/ID>/i);
  const pathMatch = xmlContent.match(/<PATH>([^<]+)<\/PATH>/);
  const scantimeMatch = xmlContent.match(/<SCANTIME>([^<]+)<\/SCANTIME>/);
  const fycoMatch = xmlContent.match(/<fyco_present>([^<]+)<\/fyco_present>/);
  
  const correctBasePath = pathMatch ? pathMatch[1] : '';
  const splitFolder = getSplitFolderFromPath(correctBasePath);
  
  console.log(`[TRANSFORM] Base path: ${correctBasePath}`);
  console.log(`[TRANSFORM] Split folder: ${splitFolder || 'None (normal container)'}`);
  
  // Ekstrak nomor container
  let correctContainerNo = '';
  const inputInfoMatch = xmlContent.match(/<IDR_SII_INPUTINFO_CONTAINER>[\s\S]*?<container_no>([^<]+)<\/container_no>[\s\S]*?<\/IDR_SII_INPUTINFO_CONTAINER>/);
  if (inputInfoMatch) {
    correctContainerNo = inputInfoMatch[1];
    console.log(`[TRANSFORM] Container number (from inputinfo): ${correctContainerNo}`);
  } else {
    const containerMatch = xmlContent.match(/<container_no>([^<]+)<\/container_no>/);
    correctContainerNo = containerMatch ? containerMatch[1] : '';
    console.log(`[TRANSFORM] Container number (general): ${correctContainerNo}`);
  }
  
  // Ekstrak data dokumen
  let correctTaxNumber = '';
  let correctNumberColli = '';
  
  const taxNumberMatch = xmlContent.match(/<tax_number>([^<]+)<\/tax_number>/);
  const numberColliMatch = xmlContent.match(/<number_of_colli>([^<]+)<\/number_of_colli>/);
  
  if (taxNumberMatch) correctTaxNumber = taxNumberMatch[1];
  if (numberColliMatch) correctNumberColli = numberColliMatch[1];
  
  console.log(`[TRANSFORM] Tax number: ${correctTaxNumber}`);
  console.log(`[TRANSFORM] Number of colli: ${correctNumberColli}`);
  
  // ============================================================
  // PERBAIKAN KRITIS: PROSES IMGTYPE UNTUK SPLIT CONTAINER
  // ============================================================
  const imgtypeMatch = xmlContent.match(/<IMGTYPE>([\s\S]*?)<\/IMGTYPE>/);
  let imgtypeContent = '';
  
  if (imgtypeMatch && imgtypeMatch[1]) {
    let imgtypeData = imgtypeMatch[1];
    
    // Jika ini split container, perbaiki URL gambar
    if (splitFolder) {
      console.log(`[TRANSFORM] 🛠️  Memproses IMGTYPE untuk split container ${splitFolder}...`);
      imgtypeData = fixImageUrlsForSplitContainer(imgtypeData, splitFolder, correctBasePath);
    } else {
      console.log(`[TRANSFORM] ℹ️  Normal container: IMGTYPE tidak diubah`);
    }
    
    // Wrap dengan CDATA
    imgtypeContent = `<![CDATA[${imgtypeData}]]>`;
    
    // Verifikasi hasil
    const imageUrls = imgtypeData.match(/http:\/\/192\.111\.111\.80:6688[^\s<>"]+\.(?:jpg|img|_icon\.jpg)/gi) || [];
    console.log(`[TRANSFORM] Final IMGTYPE memiliki ${imageUrls.length} URL gambar:`);
    imageUrls.forEach((url, i) => {
      const hasSplitFolder = splitFolder ? url.includes(`/${splitFolder}/`) : true;
      const status = hasSplitFolder ? '✅' : '❌';
      console.log(`   [${i+1}] ${status} ${url}`);
    });
  }
  
  // ============================================================
  // PROSES SCANIMG ENTRIES
  // ============================================================
  const scanImgRegex = /<IDR_SII_SCANIMG>[\s\S]*?<ENTRY_ID>([^<]+)<\/ENTRY_ID>[\s\S]*?<OPERATETIME>([^<]+)<\/OPERATETIME>[\s\S]*?<PATH>([^<]+)<\/PATH>[\s\S]*?<TYPE>([^<]+)<\/TYPE>[\s\S]*?<\/IDR_SII_SCANIMG>/g;
  let scanImgBlocks = [];
  let match;
  
  while ((match = scanImgRegex.exec(xmlContent)) !== null) {
    scanImgBlocks.push({
      entryId: match[1],
      operateTime: match[2],
      path: match[3],
      type: match[4]
    });
  }
  
  console.log(`[TRANSFORM] Found ${scanImgBlocks.length} SCANIMG entries`);
  
  let scanImgSection = '';
  scanImgBlocks.forEach((img, index) => {
    scanImgSection += `<SCANIMG><TYPE>${img.type}</TYPE><PATH>${img.path}</PATH><ENTRY_ID>${img.entryId}</ENTRY_ID><OPERATETIME>${img.operateTime}</OPERATETIME></SCANIMG>`;
    console.log(`   [${index + 1}] ${img.type}: ${img.path}`);
  });
  
  // ============================================================
  // GENERATE GROUP_ID (tanpa suffix split folder)
  // ============================================================
  let groupId = picno;
  if (splitFolder) {
    // Hapus suffix 001/002 dari PICNO untuk GROUP_ID
    groupId = picno.replace(new RegExp(`${splitFolder}$`), '');
    console.log(`[TRANSFORM] GROUP_ID (tanpa suffix): ${groupId}`);
  }
  
  // ============================================================
  // GENERATE XML AKHIR
  // ============================================================
  const transformedXML = `<?xml version="1.0" encoding="UTF-8"?>
<IDR>
  <IDR_IMAGE>
    <ID>${idMatch ? idMatch[1] : 'GENERATED-ID'}</ID>
    <PICNO>${picno}</PICNO>
    <PATH>${correctBasePath}</PATH>
    <SCANTIME>${scantimeMatch ? scantimeMatch[1] : new Date().toISOString().replace('T', ' ').substring(0, 19)}</SCANTIME>
    <IMGTYPE>${imgtypeContent}</IMGTYPE>
    <IDR_CHECK_UNIT>
      <ID>${idMatch ? idMatch[1] : 'GENERATED-UNIT-ID'}</ID>
      <IMAGEID>${idMatch ? idMatch[1] : 'GENERATED-ID'}</IMAGEID>
      <UNITID>${picno}</UNITID>
      <CHECKINTIME>${scantimeMatch ? scantimeMatch[1] : new Date().toISOString().replace('T', ' ').substring(0, 19)}</CHECKINTIME>
      <IDR_SIIG>
        <ID>GENERATED-SIIG-ID</ID>
        <TYPE>inputinfo</TYPE>
        <OPERATIONTIME>${new Date().toISOString().replace('T', ' ').substring(0, 19)}</OPERATIONTIME>
        <inputinfo>
          <general>
            <container>
              <container_no>${correctContainerNo}</container_no>
              <name_vessel></name_vessel>
              <consignee></consignee>
              <g_v_no></g_v_no>
              <article_no></article_no>
            </container>
          </general>
          <document>
            <control>
              <tax_number>${correctTaxNumber}</tax_number>
              <declaration_number></declaration_number>
              <number_of_colli>${correctNumberColli}</number_of_colli>
              <fyco_present>${fycoMatch ? fycoMatch[1] : ''}</fyco_present>
            </control>
          </document>
          <official>
            <office>0</office>
            <name_official>0</name_official>
            <phone_number>no</phone_number>
            <fax_number>no</fax_number>
          </official>
        </inputinfo>
      </IDR_SIIG>
      <IDR_SIIG>
        <ID>GENERATED-EDI-ID</ID>
        <TYPE>EDI</TYPE>
        <OPERATIONTIME>${new Date().toISOString().replace('T', ' ').substring(0, 19)}</OPERATIONTIME>
      </IDR_SIIG>
      <IDR_SIIG>
        <ID>GENERATED-POS-ID</ID>
        <TYPE>position</TYPE>
        <OPERATIONTIME>${new Date().toISOString().replace('T', ' ').substring(0, 19)}</OPERATIONTIME>
      </IDR_SIIG>
      <IDR_SIIG>
        <ID>GENERATED-SCAN-ID</ID>
        <TYPE>SCANIMG</TYPE>
        <OPERATIONTIME>${new Date().toISOString().replace('T', ' ').substring(0, 19)}</OPERATIONTIME>
        ${scanImgSection}
      </IDR_SIIG>
    </IDR_CHECK_UNIT>
  </IDR_IMAGE>
  <DEVICE_NO>${DEVICE_NO}</DEVICE_NO>
  <IMAGE_TYPE>img</IMAGE_TYPE>
  <CONCLUSION>false</CONCLUSION>
  <GROUP_ID>${groupId}</GROUP_ID>
  <gps_info>
    <longitude></longitude>
    <latitude></latitude>
  </gps_info>
  <GROUP_INDEX>1-1</GROUP_INDEX>
  <ISWISCAN>0</ISWISCAN>
</IDR>`;

  console.log(`[TRANSFORM] ✅ Transformasi selesai`);
  console.log(`[TRANSFORM] Ringkasan:`);
  console.log(`   - PICNO: ${picno}`);
  console.log(`   - Container: ${correctContainerNo}`);
  console.log(`   - PATH: ${correctBasePath}`);
  console.log(`   - Split folder: ${splitFolder || 'None'}`);
  console.log(`   - GROUP_ID: ${groupId}`);
  console.log(`   - SCANIMG entries: ${scanImgBlocks.length}`);
  
  return {
    xml: transformedXML,
    splitFolder: splitFolder,
    containerNo: correctContainerNo
  };
};

// ============================================================
// FUNGSI GENERATE FTP PATH
// ============================================================
const getFtpPath = (filePath, splitFolder) => {
  try {
    const relativePath = path.dirname(path.relative(WATCH_PATH, filePath));
    const basePath = '/import/62001FS03';
    let ftpPath = `${basePath}/${relativePath.replace(/\\/g, '/')}/`;
    
    console.log(`[FTP_PATH] Generated: ${ftpPath}`);
    
    if (splitFolder) {
      console.log(`[FTP_PATH] Split container: ${splitFolder}`);
    }
    
    return ftpPath;
  } catch (error) {
    console.error(`[FTP_PATH] Error: ${error.message}`);
    return '/import/62001FS03/';
  }
};

// ============================================================
// FUNGSI EKSTRAK DATA XML
// ============================================================
const extractXmlData = (xmlContent) => {
  const picnoMatch = xmlContent.match(/<PICNO>([^<]+)<\/PICNO>/);
  const containerMatch = xmlContent.match(/<container_no>([^<]+)<\/container_no>/);
  const deviceNoMatch = xmlContent.match(/<DEVICE_NO>([^<]+)<\/DEVICE_NO>/);
  
  return {
    picno: picnoMatch ? picnoMatch[1] : null,
    container: containerMatch ? containerMatch[1] : null,
    deviceNo: deviceNoMatch ? deviceNoMatch[1] : null
  };
};

// ============================================================
// FUNGSI DEBUG SPLIT CONTAINER
// ============================================================
const debugSplitContainer = (filePath, splitFolder) => {
  console.log(`\n[DEBUG] 🔎 Debugging split container ${splitFolder}...`);
  
  try {
    const folderPath = path.dirname(filePath);
    const parentFolder = path.dirname(folderPath);
    
    console.log(`[DEBUG] Split folder path: ${folderPath}`);
    console.log(`[DEBUG] Parent folder: ${parentFolder}`);
    
    // Cek file di split folder
    if (fs.existsSync(folderPath)) {
      const splitFiles = fs.readdirSync(folderPath)
        .filter(f => /\.(jpg|img|jpeg|png)$/i.test(f))
        .sort();
      
      console.log(`[DEBUG] Files in split folder ${splitFolder}: ${splitFiles.length}`);
      splitFiles.forEach((file, i) => {
        const filePath = `${folderPath}/${file}`;
        const stats = fs.statSync(filePath);
        console.log(`   [${i+1}] ${file} (${Math.round(stats.size/1024)} KB)`);
      });
    } else {
      console.log(`[DEBUG] ❌ Split folder tidak ditemukan: ${folderPath}`);
    }
    
    // Cek file di parent folder
    if (fs.existsSync(parentFolder)) {
      const parentFiles = fs.readdirSync(parentFolder)
        .filter(f => /\.(jpg|img|jpeg|png)$/i.test(f))
        .sort();
      
      console.log(`[DEBUG] Files in parent folder: ${parentFiles.length}`);
      if (parentFiles.length > 0) {
        console.log(`[DEBUG]   (File combined untuk semua container)`);
      }
    }
    
  } catch (error) {
    console.log(`[DEBUG] ❌ Error: ${error.message}`);
  }
};

// ============================================================
// FUNGSI UTAMA PROSES DAN KIRIM XML
// ============================================================
const processAndSendXml = async (filePath) => {
  try {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[PROCESS] 📄 Memproses file: ${path.basename(filePath)}`);
    console.log(`[PROCESS] Full path: ${filePath}`);
    console.log(`${'='.repeat(70)}`);
    
    // Baca dan validasi XML
    const { 
      content: xmlContent, 
      isValid, 
      isSubmittedXML, 
      splitFolder,
      originalPath 
    } = readAndValidateXml(filePath);
    
    console.log(`[READ] ✅ Berhasil membaca ${xmlContent.length} karakter`);
    
    // Ekstrak data penting
    const xmlData = extractXmlData(xmlContent);
    console.log(`[DATA] Data yang diekstrak:`);
    console.log(`   - PICNO: ${xmlData.picno || '❌ TIDAK DITEMUKAN'}`);
    console.log(`   - Container: ${xmlData.container || '❌ TIDAK DITEMUKAN'}`);
    console.log(`   - Device: ${xmlData.deviceNo || '❌ TIDAK DITEMUKAN'}`);
    console.log(`   - Tipe Container: ${splitFolder ? `SPLIT (${splitFolder})` : 'NORMAL'}`);
    
    if (!xmlData.picno) {
      console.error(`[ERROR] ❌ KRITIS: PICNO tidak ditemukan - tidak dapat melanjutkan`);
      return false;
    }
    
    // Jika split container, lakukan debugging
    if (splitFolder) {
      debugSplitContainer(filePath, splitFolder);
      
      // Validasi struktur split container
      const validation = validateSplitContainerStructure(xmlContent, splitFolder);
      if (!validation.valid && validation.issues.length > 0) {
        console.error(`[ERROR] ❌ Validasi split container gagal`);
        validation.issues.forEach(issue => console.error(`   ${issue}`));
        
        // Tanyakan apakah ingin melanjutkan (dalam implementasi real, bisa di-skip)
        console.log(`[WARNING] ⚠️  Masalah validasi ditemukan, melanjutkan dengan hati-hati...`);
      }
    }
    
    let finalXmlContent = xmlContent;
    let containerNo = '';
    let transformedData = null;
    
    if (isSubmittedXML) {
      console.log(`\n[INFO] 🔄 XML SUBMITTED terdeteksi - melakukan transformasi...`);
      
      // Transformasi XML
      transformedData = transformSubmittedXML(xmlContent, xmlData.picno, filePath);
      finalXmlContent = transformedData.xml;
      containerNo = transformedData.containerNo;
      
      console.log(`\n[VALIDATION] 🔍 Validasi setelah transformasi...`);
      
      // Validasi khusus untuk split container setelah transformasi
      if (splitFolder) {
        console.log(`[VALIDATION] 🧪 Validasi akhir untuk split container ${splitFolder}`);
        
        // Cek URL gambar di IMGTYPE
        const imgtypeSection = finalXmlContent.match(/<IMGTYPE>([\s\S]*?)<\/IMGTYPE>/);
        if (imgtypeSection) {
          const imgtypeData = imgtypeSection[1];
          const imageUrls = imgtypeData.match(/http:\/\/192\.111\.111\.80:6688[^\s<>"]+\.(?:jpg|img|_icon\.jpg)/gi) || [];
          
          const urlsWithSplitFolder = imageUrls.filter(url => url.includes(`/${splitFolder}/`));
          const urlsWithoutSplitFolder = imageUrls.filter(url => !url.includes(`/${splitFolder}/`));
          
          console.log(`[VALIDATION] Hasil URL gambar:`);
          console.log(`   - Total: ${imageUrls.length}`);
          console.log(`   - Dengan /${splitFolder}/: ${urlsWithSplitFolder.length} ✅`);
          console.log(`   - Tanpa /${splitFolder}/: ${urlsWithoutSplitFolder.length} ${urlsWithoutSplitFolder.length > 0 ? '❌' : '✅'}`);
          
          if (urlsWithoutSplitFolder.length > 0) {
            console.log(`[VALIDATION] ⚠️  PERINGATAN: Beberapa URL tidak mengarah ke split folder:`);
            urlsWithoutSplitFolder.forEach(url => console.log(`   - ${url}`));
          }
          
          // Validasi jumlah gambar
          const expectedCount = splitFolder ? 3 : 6; // Split: 3 gambar, Normal: 6 gambar
          if (imageUrls.length !== expectedCount) {
            console.log(`[VALIDATION] ⚠️  PERINGATAN: Jumlah gambar (${imageUrls.length}) tidak sesuai harapan (${expectedCount})`);
          }
        }
      }
      
      // Validasi struktur dasar
      const criticalChecks = {
        'Tag IDR root': finalXmlContent.includes('<IDR>'),
        'Section IDR_IMAGE': finalXmlContent.includes('<IDR_IMAGE>'),
        'PICNO sesuai': finalXmlContent.includes(`<PICNO>${xmlData.picno}</PICNO>`),
        'IDR_CHECK_UNIT': finalXmlContent.includes('<IDR_CHECK_UNIT>'),
        'SCANIMG entries': finalXmlContent.includes('<SCANIMG>'),
        'DEVICE_NO': finalXmlContent.includes('<DEVICE_NO>'),
        'IMGTYPE valid': !finalXmlContent.includes('<IMGTYPE></IMGTYPE>'),
        'CDATA wrapper': finalXmlContent.includes('<![CDATA[')
      };
      
      console.log(`[VALIDATION] Pengecekan kritis:`);
      Object.entries(criticalChecks).forEach(([check, result]) => {
        console.log(`   ${result ? '✅' : '❌'} ${check}`);
      });
      
      const hasCriticalErrors = Object.values(criticalChecks).some(result => !result);
      if (hasCriticalErrors) {
        console.error(`[ERROR] ❌ Kesalahan kritis ditemukan - menghentikan proses`);
        return false;
      }
      
      console.log(`[VALIDATION] ✅ Semua validasi berhasil`);
      
    } else {
      console.log(`\n[INFO] ℹ️  XML INITIAL terdeteksi - menggunakan as-is`);
    }
    
    // Generate FTP path
    const ftpPath = getFtpPath(filePath, splitFolder);
    
    // Siapkan payload
    const payload = {
      ftp_path: ftpPath,
      image_msg: finalXmlContent
    };
    
    console.log(`\n[PAYLOAD] 📦 Menyiapkan payload...`);
    console.log(`[PAYLOAD] ftp_path: ${ftpPath}`);
    console.log(`[PAYLOAD] xml_length: ${finalXmlContent.length} karakter`);
    console.log(`[PAYLOAD] tipe_container: ${splitFolder ? `SPLIT (${splitFolder})` : 'NORMAL'}`);
    console.log(`[PAYLOAD] container_no: ${containerNo || xmlData.container}`);
    
    // Tampilkan preview XML
    const xmlPreview = finalXmlContent.substring(0, 500);
    console.log(`[PAYLOAD] XML preview (500 karakter pertama):`);
    console.log(`\n${xmlPreview}...\n`);
    
    // Kirim ke server
    console.log(`\n[SEND] 🚀 Mengirim data ke server...`);
    console.log(`[SEND] URL: ${POST_URL}`);
    console.log(`[SEND] Timeout: 30 detik`);
    
    const response = await axios.post(POST_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    
    console.log(`\n[RESPONSE] 📥 Respons dari server:`);
    console.log(`[RESPONSE] HTTP Status: ${response.status}`);
    
    if (response.data && response.data.resultCode === true) {
      console.log(`[RESPONSE] ✅ SUKSES!`);
      console.log(`[RESPONSE] Pesan: ${response.data.resultDesc || 'Data berhasil diproses'}`);
      
      if (response.data.resultData) {
        const dataPreview = JSON.stringify(response.data.resultData).substring(0, 200);
        console.log(`[RESPONSE] Data preview: ${dataPreview}${dataPreview.length >= 200 ? '...' : ''}`);
      }
      
      console.log(`\n${'='.repeat(70)}`);
      console.log(`✅ FILE BERHASIL DIPROSES: ${path.basename(filePath)}`);
      console.log(`   Tipe: ${splitFolder ? `Split Container ${splitFolder}` : 'Normal Container'}`);
      console.log(`   Waktu: ${new Date().toLocaleString('id-ID')}`);
      console.log(`${'='.repeat(70)}\n`);
      
      return true;
      
    } else {
      console.log(`[RESPONSE] ❌ GAGAL`);
      console.log(`[RESPONSE] Error: ${response.data?.resultDesc || 'Error tidak diketahui'}`);
      
      // Analisis error
      if (response.data?.resultDesc) {
        console.log(`\n[ERROR ANALYSIS] 🔍 Menganalisis error...`);
        
        const errorMsg = response.data.resultDesc.toLowerCase();
        
        if (errorMsg.includes('container') || errorMsg.includes('kontainer')) {
          console.log(`   💡 MASALAH: Nomor container tidak terbaca`);
          console.log(`   💡 Container dalam XML: "${containerNo || xmlData.container}"`);
          console.log(`   💡 Saran: Periksa format nomor container`);
        }
        
        if (errorMsg.includes('image') || errorMsg.includes('gambar')) {
          console.log(`   💡 MASALAH: Problem dengan gambar`);
          console.log(`   💡 Kemungkinan penyebab:`);
          console.log(`      - File gambar tidak ditemukan di path yang ditentukan`);
          console.log(`      - URL gambar salah di IMGTYPE`);
          console.log(`      - Akses ke server gambar ditolak`);
          console.log(`   💡 Untuk split container ${splitFolder || ''}:`);
          console.log(`      - Pastikan gambar ada di subfolder /${splitFolder}/`);
          console.log(`      - Pastikan URL mengandung /${splitFolder}/`);
        }
        
        if (errorMsg.includes('format') || errorMsg.includes('parameter')) {
          console.log(`   💡 MASALAH: Format parameter salah`);
          console.log(`   💡 Saran: Periksa struktur XML sesuai kebutuhan server`);
        }
      }
      
      console.log(`\n${'='.repeat(70)}`);
      console.log(`❌ FILE GAGAL DIPROSES: ${path.basename(filePath)}`);
      console.log(`${'='.repeat(70)}\n`);
      
      return false;
    }
    
  } catch (error) {
    console.log(`\n[ERROR] 💥 Terjadi exception selama pemrosesan`);
    
    if (error.response) {
      // Server merespons dengan error
      console.error(`[ERROR] Server merespons dengan error`);
      console.error(`[ERROR] HTTP Status: ${error.response.status}`);
      console.error(`[ERROR] Response data: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // Tidak ada respons dari server
      console.error(`[ERROR] Koneksi error - tidak ada respons dari server`);
      console.error(`[ERROR] Detail: ${error.message}`);
      console.error(`[ERROR] Periksa apakah server dapat diakses: ${POST_URL}`);
    } else if (error.code === 'ECONNABORTED') {
      // Timeout
      console.error(`[ERROR] ⏱️  Timeout - koneksi ke server terlalu lama`);
      console.error(`[ERROR] Periksa koneksi jaringan atau server mungkin sibuk`);
    } else {
      // Error lainnya
      console.error(`[ERROR] Error pemrosesan: ${error.message}`);
      console.error(`[ERROR] Stack trace: ${error.stack}`);
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`❌ ERROR PEMROSESAN FILE: ${path.basename(filePath)}`);
    console.log(`${'='.repeat(70)}\n`);
    
    return false;
  }
};

// ============================================================
// INISIALISASI FILE WATCHER
// ============================================================
console.log(`\n[WATCHER] 👀 Menginisialisasi file watcher...`);

const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,
  ignoreInitial: true,
  recursive: true,
  usePolling: true,
  interval: 3000,
  ignored: /(^|[/\\])\../,
  depth: 5
});

const activeTimers = new Map();

// ============================================================
// HANDLER UNTUK FILE BARU
// ============================================================
watcher.on('add', (filePath) => {
  if (path.extname(filePath).toLowerCase() === '.xml') {
    const fileName = path.basename(filePath);
    
    // Hapus timer lama jika ada
    if (activeTimers.has(filePath)) {
      clearTimeout(activeTimers.get(filePath));
      activeTimers.delete(filePath);
      console.log(`[WATCHER] ⚠️  Timer di-reset untuk: ${fileName}`);
    }
    
    console.log(`\n${'~'.repeat(70)}`);
    console.log(`[WATCHER] 🔔 File XML baru terdeteksi!`);
    console.log(`[WATCHER] File: ${fileName}`);
    console.log(`[WATCHER] Path: ${filePath}`);
    console.log(`[WATCHER] Waktu: ${new Date().toLocaleString('id-ID')}`);
    console.log(`[WATCHER] ⏳ Menunggu ${WAIT_TIME_MS / 1000} detik sebelum memproses...`);
    console.log(`${'~'.repeat(70)}`);
    
    // Set timer untuk menunggu file selesai ditulis
    const timer = setTimeout(async () => {
      console.log(`\n${'█'.repeat(70)}`);
      console.log(`[PROCESS] ⚡ Memulai proses: ${fileName}`);
      console.log(`[PROCESS] Waktu tunggu selesai: ${new Date().toLocaleString('id-ID')}`);
      console.log(`${'█'.repeat(70)}`);
      
      activeTimers.delete(filePath);
      
      try {
        // Periksa file sebelum diproses
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
          console.error(`[ERROR] ❌ File kosong (0 bytes) - dilewati`);
          return;
        }
        
        console.log(`[PROCESS] Ukuran file: ${stats.size} bytes`);
        console.log(`[PROCESS] Modifikasi terakhir: ${stats.mtime.toLocaleString('id-ID')}`);
        
        // Proses file
        await processAndSendXml(filePath);
        
      } catch (error) {
        console.error(`[ERROR] ❌ Tidak dapat mengakses atau memproses file`);
        console.error(`[ERROR] Alasan: ${error.message}`);
        
        if (error.code === 'ENOENT') {
          console.error(`[ERROR] File tidak ditemukan - mungkin dipindah atau dihapus`);
        }
      }
      
      console.log(`${'█'.repeat(70)}\n`);
    }, WAIT_TIME_MS);
    
    activeTimers.set(filePath, timer);
  }
});

// ============================================================
// HANDLER ERROR WATCHER
// ============================================================
watcher.on('error', (error) => {
  console.error(`\n[WATCHER ERROR] ❌ ${error.message}`);
  console.error(`[WATCHER ERROR] Stack: ${error.stack}`);
});

// ============================================================
// HANDLER READY
// ============================================================
watcher.on('ready', () => {
  console.log(`[WATCHER] ✅ File watcher siap dan memantau`);
  console.log(`[WATCHER] Memantau path: ${WATCH_PATH}`);
  console.log(`[WATCHER] Recursive: Ya`);
  console.log(`[WATCHER] Polling interval: 3000ms`);
  console.log(`[WATCHER] Depth: 5 level`);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ SERVICE BERJALAN. Menunggu file XML...`);
  console.log(`   Tekan Ctrl+C untuk menghentikan service`);
  console.log(`${'═'.repeat(60)}\n`);
});

// ============================================================
// HANDLER SHUTDOWN
// ============================================================
process.on('SIGINT', () => {
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`[SHUTDOWN] 🛑 Sinyal shutdown diterima (Ctrl+C)`);
  console.log(`[SHUTDOWN] Membersihkan...`);
  
  const timerCount = activeTimers.size;
  activeTimers.forEach((timer) => clearTimeout(timer));
  console.log(`[SHUTDOWN] Cleared ${timerCount} active timer(s)`);
  
  watcher.close();
  console.log(`[SHUTDOWN] File watcher ditutup`);
  
  console.log(`[SHUTDOWN] ✅ Service dihentikan dengan baik`);
  console.log(`[SHUTDOWN] Berhenti pada: ${new Date().toLocaleString('id-ID')}`);
  console.log(`${'═'.repeat(60)}\n`);
  
  process.exit(0);
});

// ============================================================
// HANDLER ERROR LAINNYA
// ============================================================
process.on('uncaughtException', (error) => {
  console.error(`\n[CRITICAL] 💥 Uncaught Exception!`);
  console.error(`[CRITICAL] Error: ${error.message}`);
  console.error(`[CRITICAL] Stack: ${error.stack}`);
  console.error(`[CRITICAL] Service mungkin perlu restart\n`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`\n[CRITICAL] 💥 Unhandled Promise Rejection!`);
  console.error(`[CRITICAL] Reason: ${reason}`);
  console.error(`[CRITICAL] Service mungkin perlu restart\n`);
});

console.log(`[WATCHER] ⏳ Menginisialisasi... Mohon tunggu...`);