const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- KONFIGURASI ---
const WATCH_PATH = 'D:\\Image\\62001FS02'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/in';
const WAIT_TIME_MS = 60000;
const DEVICE_NO = '62001FS02';
// -------------------

console.log('XML Watcher Service');
console.log(`[INFO] Service dimulai...`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log(`[INFO] Device: ${DEVICE_NO}`);
console.log('---------------------------');

/**
 * Fungsi untuk membaca dan validasi XML dengan namespace handling
 */
const readAndValidateXml = (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    console.log(`[READ] File size: ${fileBuffer.length} bytes`);
    
    let xmlContent;
    
    // Handle UTF-16 LE
    if (fileBuffer[0] === 0xFF && fileBuffer[1] === 0xFE) {
      console.log(`[ENCODING] UTF-16 LE detected, converting...`);
      xmlContent = fileBuffer.slice(2).toString('utf16le');
      xmlContent = xmlContent.replace(/encoding="UTF-16"/gi, 'encoding="UTF-8"');
    } else {
      xmlContent = fileBuffer.toString('utf8');
    }
    
    // Validasi - cek tag yang benar-benar critical
    const hasIDRImage = xmlContent.includes('<IDR_IMAGE>');
    const hasPICNO = xmlContent.includes('<PICNO>');
    const hasIDRCheckUnit = xmlContent.includes('<IDR_CHECK_UNIT>');
    
    // Cek apakah ini XML hasil submit (punya IDR_SII_SCANIMG) atau XML scan awal (punya SCANIMG langsung)
    const isSubmittedXML = xmlContent.includes('<IDR_SII_SCANIMG>');
    const isInitialXML = xmlContent.includes('<SCANIMG>') && !xmlContent.includes('<IDR_SII_SCANIMG>');
    
    console.log(`[VALIDATION] Type: ${isSubmittedXML ? 'SUBMITTED XML' : (isInitialXML ? 'INITIAL XML' : 'UNKNOWN')}`);
    console.log(`[VALIDATION] Has IDR_IMAGE: ${hasIDRImage}`);
    console.log(`[VALIDATION] Has PICNO: ${hasPICNO}`);
    console.log(`[VALIDATION] Has IDR_CHECK_UNIT: ${hasIDRCheckUnit}`);
    
    const isValid = hasIDRImage && hasPICNO && hasIDRCheckUnit;
    
    if (!isValid) {
      console.log(`[VALIDATION] ❌ MISSING CRITICAL TAGS`);
    } else {
      console.log(`[VALIDATION] ✅ Core structure valid`);
    }
    
    return {
      content: xmlContent,
      isValid: isValid,
      isSubmittedXML: isSubmittedXML,
      isInitialXML: isInitialXML
    };
    
  } catch (error) {
    throw new Error(`Gagal membaca file: ${error.message}`);
  }
};

/**
 * Transform XML hasil submit ke format yang diterima server
 * FIXED: Path adjustment untuk split container
 */
const transformSubmittedXML = (xmlContent, picno, originalFilePath) => {
  console.log(`[TRANSFORM] Converting submitted XML to server format...`);
  
  // Extract data yang diperlukan
  const containerMatch = xmlContent.match(/<container_no>([^<]+)<\/container_no>/);
  const fycoMatch = xmlContent.match(/<fyco_present>([^<]+)<\/fyco_present>/);
  const idMatch = xmlContent.match(/<ID>\{?([A-F0-9-]+)\}?<\/ID>/i);
  const pathMatch = xmlContent.match(/<PATH>([^<]+)<\/PATH>/);
  const scantimeMatch = xmlContent.match(/<SCANTIME>([^<]+)<\/SCANTIME>/);
  
  // Dapatkan path yang benar dari XML (termasuk subfolder split seperti 001/, 002/)
  const correctBasePath = pathMatch ? pathMatch[1] : '';
  console.log(`[TRANSFORM] Correct base path: ${correctBasePath}`);
  
  // Extract container number dari inputinfo section
  let correctContainerNo = '';
  const inputInfoMatch = xmlContent.match(/<IDR_SII_INPUTINFO_CONTAINER>[\s\S]*?<container_no>([^<]+)<\/container_no>[\s\S]*?<\/IDR_SII_INPUTINFO_CONTAINER>/);
  if (inputInfoMatch) {
    correctContainerNo = inputInfoMatch[1];
    console.log(`[TRANSFORM] Container from inputinfo: ${correctContainerNo}`);
  } else if (containerMatch) {
    correctContainerNo = containerMatch[1];
    console.log(`[TRANSFORM] Container from general: ${correctContainerNo}`);
  }
  
  // Extract tax_number dan number_of_colli
  let correctTaxNumber = '';
  let correctNumberColli = '';
  
  const taxNumberMatch = xmlContent.match(/<tax_number>([^<]+)<\/tax_number>/);
  const numberColliMatch = xmlContent.match(/<number_of_colli>([^<]+)<\/number_of_colli>/);
  
  if (taxNumberMatch) correctTaxNumber = taxNumberMatch[1];
  if (numberColliMatch) correctNumberColli = numberColliMatch[1];
  
  console.log(`[TRANSFORM] Tax number: ${correctTaxNumber}, Colli: ${correctNumberColli}`);

  // ===== PERBAIKAN UTAMA: Handle IMGTYPE path adjustment =====
  const imgtypeMatch = xmlContent.match(/<IMGTYPE>([\s\S]*?)<\/IMGTYPE>/);
  let imgtypeContent = '';
  
  if (imgtypeMatch && imgtypeMatch[1]) {
    let adjustedImgtype = imgtypeMatch[1];
    
    // Deteksi apakah ini split container (ada subfolder 001, 002, dll)
    const splitFolderMatch = correctBasePath.match(/\/(\d{3})\/?$/);
    const splitFolder = splitFolderMatch ? splitFolderMatch[1] : null;
    
    if (splitFolder) {
      console.log(`[TRANSFORM] Detected split container - subfolder: ${splitFolder}`);
      
      const imgPathRegex = /(http:\/\/192\.111\.111\.80:6688\/62001FS0[23]\/\d{4}\/\d{4}\/\d+)\/([\w\-\.]+\.(?:jpg|img))/gi;
      
      adjustedImgtype = adjustedImgtype.replace(imgPathRegex, (match, basePath, filename) => {
        // Insert split folder antara base path dan filename
        const newPath = `${basePath}/${splitFolder}/${filename}`;
        console.log(`[PATH ADJUSTMENT] ${match} -> ${newPath}`);
        return newPath;
      });
      
      // Handle juga relative path jika ada
      const relativePathRegex = /(\/62001FS0[23]\/\d{4}\/\d{4}\/\d+)\/([\w\-\.]+\.(?:jpg|img))/gi;
      adjustedImgtype = adjustedImgtype.replace(relativePathRegex, (match, basePath, filename) => {
        const newPath = `${basePath}/${splitFolder}/${filename}`;
        console.log(`[RELATIVE PATH ADJUSTMENT] ${match} -> ${newPath}`);
        return newPath;
      });
    } else {
      console.log(`[TRANSFORM] No split detected - using original paths`);
    }
    
    // Gunakan CDATA untuk konten kompleks
    imgtypeContent = `<![CDATA[${adjustedImgtype}]]>`;
  }

  // Extract SCANIMG entries
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
  
  // Build SCANIMG section
  let scanImgSection = '';
  scanImgBlocks.forEach((img, index) => {
    scanImgSection += `<SCANIMG><TYPE>${img.type}</TYPE><PATH>${img.path}</PATH><ENTRY_ID>${img.entryId}</ENTRY_ID><OPERATETIME>${img.operateTime}</OPERATETIME></SCANIMG>`;
    console.log(`[SCANIMG-${index}] ${img.entryId} -> ${img.path}`);
  });
  
  // Generate GROUP_ID
  const groupId = picno;
  
  // Build XML baru
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

  console.log(`[TRANSFORM] ✅ Transformation complete`);
  console.log(`[TRANSFORM] Container: ${correctContainerNo}`);
  console.log(`[TRANSFORM] Base path: ${correctBasePath}`);
  console.log(`[TRANSFORM] PICNO: ${picno}`);
  
  return transformedXML;
};

/**
 * Fungsi untuk mendapatkan ftp_path yang sesuai
 */
const getFtpPath = (filePath) => {
  try {
    const relativePath = path.dirname(path.relative(WATCH_PATH, filePath));
    const basePath = '/export/62001FS02';
    let ftpPath = `${basePath}/${relativePath.replace(/\\/g, '/')}/`;
    console.log(`[FTP_PATH] Generated: ${ftpPath}`);
    return ftpPath;
  } catch (error) {
    return '/export/62001FS02/';
  }
};

/**
 * Fungsi untuk mengekstrak data dari XML
 */
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

/**
 * Fungsi utama untuk memproses dan mengirim
 */
const processAndSendXml = async (filePath) => {
  try {
    console.log(`\n[PROCESS] Processing: ${path.basename(filePath)}`);
    
    // 1. Baca dan validasi XML
    const { content: xmlContent, isValid, isSubmittedXML, isInitialXML } = readAndValidateXml(filePath);
    console.log(`[READ] Successfully read ${xmlContent.length} characters`);
    
    // 2. Ekstrak data
    const xmlData = extractXmlData(xmlContent);
    console.log(`[DATA] PICNO: ${xmlData.picno || 'NOT FOUND'}`);
    console.log(`[DATA] Container: ${xmlData.container || 'NOT FOUND'}`);
    console.log(`[DATA] Device: ${xmlData.deviceNo || 'NOT FOUND'}`);
    
    if (!xmlData.picno) {
      console.error(`❌ CRITICAL: PICNO not found in XML`);
      return false;
    }
    
    if (!isValid) {
      console.log(`\n⚠️ XML structure incomplete, attempting to process anyway...`);
    }
    
    // 3. Transform XML jika ini adalah submitted XML
    let finalXmlContent = xmlContent;
    let correctBasePath = '';
    let correctContainerNo = '';
    
    if (isSubmittedXML) {
      console.log(`\n[INFO] Detected submitted XML - transforming to server format...`);
      
      // Extract correct base path dan container
      const pathMatch = xmlContent.match(/<PATH>([^<]+)<\/PATH>/);
      correctBasePath = pathMatch ? pathMatch[1] : '';
      
      const inputInfoMatch = xmlContent.match(/<IDR_SII_INPUTINFO_CONTAINER>[\s\S]*?<container_no>([^<]+)<\/container_no>[\s\S]*?<\/IDR_SII_INPUTINFO_CONTAINER>/);
      correctContainerNo = inputInfoMatch ? inputInfoMatch[1] : (xmlContent.match(/<container_no>([^<]+)<\/container_no>/) || [])[1];
      
      console.log(`[ORIGINAL XML] Base path: ${correctBasePath}`);
      console.log(`[ORIGINAL XML] Container: ${correctContainerNo}`);
      
      finalXmlContent = transformSubmittedXML(xmlContent, xmlData.picno, filePath);
      
      // Validasi path consistency
      console.log(`[PATH VALIDATION] Checking path consistency...`);
      
      // Cek path dalam IMGTYPE
      const pathInImgtype = finalXmlContent.match(/http:\/\/192\.111\.111\.80:6688\/62001FS0[23]\/[^<"\s]+\.(?:jpg|img)/gi);
      if (pathInImgtype) {
        console.log(`[PATH VALIDATION] Found ${pathInImgtype.length} image paths in IMGTYPE:`);
        pathInImgtype.slice(0, 3).forEach((imgPath, index) => {
          console.log(`   [${index}] ${imgPath}`);
        });
        if (pathInImgtype.length > 3) {
          console.log(`   ... and ${pathInImgtype.length - 3} more`);
        }
      }
      
      // Validasi container number
      const transformedContainerMatch = finalXmlContent.match(/<container_no>([^<]+)<\/container_no>/);
      const transformedContainer = transformedContainerMatch ? transformedContainerMatch[1] : '';
      const containerCorrect = transformedContainer === correctContainerNo;
      
      console.log(`[CONTAINER VALIDATION] Original: ${correctContainerNo}, Transformed: ${transformedContainer} ${containerCorrect ? '✅' : '❌'}`);
      
      // Validasi tambahan
      console.log(`[VALIDATION] Checking transformed XML...`);
      const criticalChecks = {
        'Root IDR tag': finalXmlContent.includes('<IDR>'),
        'IDR_IMAGE section': finalXmlContent.includes('<IDR_IMAGE>'),
        'PICNO': finalXmlContent.includes('<PICNO>'),
        'IDR_CHECK_UNIT': finalXmlContent.includes('<IDR_CHECK_UNIT>'),
        'SCANIMG entries': finalXmlContent.includes('<SCANIMG>'),
        'DEVICE_NO': finalXmlContent.includes('<DEVICE_NO>'),
        'Valid IMGTYPE': !finalXmlContent.includes('<IMGTYPE></IMGTYPE>'),
        'CDATA in IMGTYPE': finalXmlContent.includes('<![CDATA['),
        'Container Consistency': containerCorrect
      };
      
      console.log(`[VALIDATION] Transformed XML check:`);
      Object.entries(criticalChecks).forEach(([check, result]) => {
        console.log(`   ${result ? '✅' : '❌'} ${check}`);
      });
      
      if (!criticalChecks['Container Consistency']) {
        console.error(`❌ CRITICAL: Container number mismatch`);
        return false;
      }
      
      // Validasi PICNO
      if (!finalXmlContent.includes(`<PICNO>${xmlData.picno}</PICNO>`)) {
        console.error(`❌ TRANSFORMATION ERROR: PICNO mismatch`);
        return false;
      }
    }
    
    // 4. Siapkan payload
    const ftpPath = getFtpPath(filePath);
    const payload = {
      ftp_path: ftpPath,
      image_msg: finalXmlContent
    };
    
    console.log(`[PAYLOAD] ftp_path: ${ftpPath}`);
    console.log(`[PAYLOAD] image_msg length: ${finalXmlContent.length} chars`);
    console.log(`[PAYLOAD] XML was ${isSubmittedXML ? 'TRANSFORMED' : 'USED AS-IS'}`);
    
    // 5. Kirim ke server
    console.log(`[SEND] Sending to server...`);
    
    const response = await axios.post(POST_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    
    // 6. Handle response
    console.log(`[RESPONSE] HTTP Status: ${response.status}`);
    
    if (response.data && response.data.resultCode === true) {
      console.log(`✅ SUCCESS: ${response.data.resultDesc || 'Data processed successfully'}`);
      if (response.data.resultData) {
        console.log(`📊 Data: ${JSON.stringify(response.data.resultData).substring(0, 200)}...`);
      }
      return true;
    } else {
      console.log(`❌ FAILED: ${response.data?.resultDesc || 'Unknown error'}`);
      
      // Detailed error analysis
      if (response.data?.resultDesc?.includes('Container Tidak Terbaca')) {
        console.log(`🔍 ANALYSIS: Container number issue`);
        console.log(`   Container in XML: "${correctContainerNo}"`);
      }
      
      if (response.data?.resultDesc?.includes('Format Input Parameter')) {
        console.log(`🔍 ANALYSIS: Input parameter format invalid`);
      }
      
      if (response.data?.resultDesc?.includes('image')) {
        console.log(`🔍 ANALYSIS: Image related issue`);
      }
      
      return false;
    }
    
  } catch (error) {
    if (error.response) {
      console.error(`💥 SERVER ERROR: ${error.response.status}`);
      console.error(`💥 Response: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`💥 CONNECTION ERROR: ${error.message}`);
    } else {
      console.error(`💥 PROCESSING ERROR: ${error.message}`);
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

// Timer management
const activeTimers = new Map();

watcher.on('add', (filePath) => {
  if (path.extname(filePath).toLowerCase() === '.xml') {
    const fileName = path.basename(filePath);
    
    // Cleanup previous timer
    if (activeTimers.has(filePath)) {
      clearTimeout(activeTimers.get(filePath));
      activeTimers.delete(filePath);
    }
    
    console.log(`\n[DETECTED] XML file: ${fileName}`);
    console.log(`[INFO] Waiting ${WAIT_TIME_MS / 1000} seconds...`);
    
    // Set new timer
    const timer = setTimeout(async () => {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`[PROCESS] Starting processing: ${fileName}`);
      console.log(`${'='.repeat(50)}`);
      activeTimers.delete(filePath);
      
      try {
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
          console.error(`[ERROR] File is empty (0 bytes)`);
          return;
        }
        
        await processAndSendXml(filePath);
      } catch (error) {
        console.error(`[ERROR] Cannot access file: ${error.message}`);
      }
      
      console.log(`${'='.repeat(50)}\n`);
    }, WAIT_TIME_MS);
    
    activeTimers.set(filePath, timer);
  }
});

// Error handling
watcher.on('error', (error) => {
  console.error(`[WATCHER ERROR] ${error}`);
});

// Cleanup
process.on('SIGINT', () => {
  console.log('\n[INFO] Shutting down service...');
  activeTimers.forEach((timer) => clearTimeout(timer));
  watcher.close();
  process.exit(0);
});

console.log(`[INFO] Watcher initialized successfully. Waiting for XML files...`);