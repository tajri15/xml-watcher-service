const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const WATCH_PATH = 'D:\\Image\\62001FS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';
const WAIT_TIME_MS = 60000;
const DEVICE_NO = '62001FS03';

console.log('╔════════════════════════════════════════════════════╗');
console.log('║             XML Watcher Service - IMPORT           ║');
console.log('╚════════════════════════════════════════════════════╝');
console.log(`[INFO] Service dimulai pada: ${new Date().toLocaleString('id-ID')}`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log(`[INFO] Device: ${DEVICE_NO}`);
console.log(`[INFO] Wait time: ${WAIT_TIME_MS / 1000} detik`);
console.log('═'.repeat(60));

/**
 * Fungsi untuk membaca dan validasi XML dengan namespace handling
 * Mendukung encoding UTF-16 LE dan UTF-8
 */
const readAndValidateXml = (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    console.log(`[READ] File size: ${fileBuffer.length} bytes`);
    
    let xmlContent;
    
    // Handle UTF-16 LE (File yang dimulai dengan BOM FF FE)
    if (fileBuffer[0] === 0xFF && fileBuffer[1] === 0xFE) {
      console.log(`[ENCODING] UTF-16 LE detected, converting to UTF-8...`);
      xmlContent = fileBuffer.slice(2).toString('utf16le');
      xmlContent = xmlContent.replace(/encoding="UTF-16"/gi, 'encoding="UTF-8"');
    } else {
      xmlContent = fileBuffer.toString('utf8');
    }
    
    // Validasi struktur XML - cek tag critical
    const hasIDRImage = xmlContent.includes('<IDR_IMAGE>');
    const hasPICNO = xmlContent.includes('<PICNO>');
    const hasIDRCheckUnit = xmlContent.includes('<IDR_CHECK_UNIT>');
    
    // Deteksi tipe XML
    const isSubmittedXML = xmlContent.includes('<IDR_SII_SCANIMG>');
    const isInitialXML = xmlContent.includes('<SCANIMG>') && !xmlContent.includes('<IDR_SII_SCANIMG>');
    
    console.log(`[VALIDATION] Type: ${isSubmittedXML ? 'SUBMITTED XML (from operator)' : (isInitialXML ? 'INITIAL XML (from scanner)' : 'UNKNOWN')}`);
    console.log(`[VALIDATION] Has IDR_IMAGE: ${hasIDRImage ? '✅' : '❌'}`);
    console.log(`[VALIDATION] Has PICNO: ${hasPICNO ? '✅' : '❌'}`);
    console.log(`[VALIDATION] Has IDR_CHECK_UNIT: ${hasIDRCheckUnit ? '✅' : '❌'}`);
    
    const isValid = hasIDRImage && hasPICNO && hasIDRCheckUnit;
    
    if (!isValid) {
      console.log(`[VALIDATION] ⚠️ XML structure incomplete`);
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
 * PERBAIKAN UTAMA: Transform XML dengan handling split container yang lebih baik
 */
const transformSubmittedXML = (xmlContent, picno, originalFilePath) => {
  console.log(`[TRANSFORM] Converting submitted XML to server format...`);
  
  // Extract data yang diperlukan dari XML
  const idMatch = xmlContent.match(/<ID>\{?([A-F0-9-]+)\}?<\/ID>/i);
  const pathMatch = xmlContent.match(/<PATH>([^<]+)<\/PATH>/);
  const scantimeMatch = xmlContent.match(/<SCANTIME>([^<]+)<\/SCANTIME>/);
  const fycoMatch = xmlContent.match(/<fyco_present>([^<]+)<\/fyco_present>/);
  
  // Dapatkan path yang benar dari XML (termasuk subfolder split seperti 001/, 002/)
  const correctBasePath = pathMatch ? pathMatch[1] : '';
  console.log(`[TRANSFORM] Base path from XML: ${correctBasePath}`);
  
  // Extract container number dari section inputinfo (yang paling akurat)
  let correctContainerNo = '';
  const inputInfoMatch = xmlContent.match(/<IDR_SII_INPUTINFO_CONTAINER>[\s\S]*?<container_no>([^<]+)<\/container_no>[\s\S]*?<\/IDR_SII_INPUTINFO_CONTAINER>/);
  if (inputInfoMatch) {
    correctContainerNo = inputInfoMatch[1];
    console.log(`[TRANSFORM] Container number: ${correctContainerNo} (from inputinfo)`);
  } else {
    // Fallback ke container_no umum jika tidak ada di inputinfo
    const containerMatch = xmlContent.match(/<container_no>([^<]+)<\/container_no>/);
    correctContainerNo = containerMatch ? containerMatch[1] : '';
    console.log(`[TRANSFORM] Container number: ${correctContainerNo} (from general)`);
  }
  
  // Extract tax_number dan number_of_colli
  let correctTaxNumber = '';
  let correctNumberColli = '';
  
  const taxNumberMatch = xmlContent.match(/<tax_number>([^<]+)<\/tax_number>/);
  const numberColliMatch = xmlContent.match(/<number_of_colli>([^<]+)<\/number_of_colli>/);
  
  if (taxNumberMatch) correctTaxNumber = taxNumberMatch[1];
  if (numberColliMatch) correctNumberColli = numberColliMatch[1];
  
  console.log(`[TRANSFORM] Tax number: ${correctTaxNumber}`);
  console.log(`[TRANSFORM] Number of colli: ${correctNumberColli}`);

  // ═══════════════════════════════════════════════════════════
  // PERBAIKAN UTAMA: Handle IMGTYPE path adjustment untuk split container
  // ═══════════════════════════════════════════════════════════
  const imgtypeMatch = xmlContent.match(/<IMGTYPE>([\s\S]*?)<\/IMGTYPE>/);
  let imgtypeContent = '';
  
  if (imgtypeMatch && imgtypeMatch[1]) {
    let adjustedImgtype = imgtypeMatch[1];
    
    // Deteksi apakah ini split container (ada subfolder 001, 002, 003, dst)
    const splitFolderMatch = correctBasePath.match(/\/(\d{3})\/?$/);
    const splitFolder = splitFolderMatch ? splitFolderMatch[1] : null;
    
    if (splitFolder) {
      console.log(`[TRANSFORM] ✅ Detected SPLIT container - subfolder: ${splitFolder}`);
      console.log(`[TRANSFORM] Will adjust image paths to include /${splitFolder}/ folder`);
      
      // PERBAIKAN REGEX: Menangani berbagai format path gambar
      const imgPathPatterns = [
        // Pattern 1: Full URL path dengan .jpg, .img, _icon.jpg, high.img, low.img, material.img
        /(http:\/\/192\.111\.111\.80:6688\/62001FS03\/\d{4}\/\d{4}\/\d+)\/([\w\-\.]+\.(?:jpg|img|_icon\.jpg|high\.img|low\.img|material\.img))/gi,
        
        // Pattern 2: Relative path dengan berbagai ekstensi
        /(\/62001FS03\/\d{4}\/\d{4}\/\d+)\/([\w\-\.]+\.(?:jpg|img|_icon\.jpg|high\.img|low\.img|material\.img))/gi
      ];
      
      let totalAdjustmentCount = 0;
      
      imgPathPatterns.forEach((pattern, patternIndex) => {
        let patternAdjustmentCount = 0;
        adjustedImgtype = adjustedImgtype.replace(pattern, (match, basePath, filename) => {
          // Skip jika path sudah mengandung folder split (hindari double adjustment)
          if (basePath.includes(`/${splitFolder}`)) {
            return match;
          }
          
          // Insert split folder di antara base path dan filename
          const newPath = `${basePath}/${splitFolder}/${filename}`;
          patternAdjustmentCount++;
          console.log(`[PATH FIX Pattern ${patternIndex + 1}.${patternAdjustmentCount}] ${filename}`);
          console.log(`   FROM: ${match}`);
          console.log(`   TO:   ${newPath}`);
          return newPath;
        });
        
        totalAdjustmentCount += patternAdjustmentCount;
        console.log(`[TRANSFORM] Pattern ${patternIndex + 1} adjusted ${patternAdjustmentCount} paths`);
      });
      
      console.log(`[TRANSFORM] ✅ Total adjusted ${totalAdjustmentCount} image paths`);
      
      // Validasi tambahan: Pastikan semua path utama sudah disesuaikan
      const mainImagePattern = /62001FS03\d{12}\.(?:jpg|img)/g;
      const mainImages = adjustedImgtype.match(mainImagePattern);
      if (mainImages) {
        console.log(`[TRANSFORM] Found ${mainImages.length} main images that need path adjustment`);
        
        mainImages.forEach((imgName, index) => {
          // Cek apakah image ini sudah memiliki path yang benar
          if (!adjustedImgtype.includes(`/${splitFolder}/${imgName}`)) {
            console.log(`[WARNING] Main image ${imgName} may not have correct split folder path`);
          }
        });
      }
      
    } else {
      console.log(`[TRANSFORM] ℹ️ No split detected - container is NOT split, using original paths`);
      
      // Untuk container normal, validasi bahwa path gambar sudah benar
      const imageUrls = adjustedImgtype.match(/http:\/\/192\.111\.111\.80:6688\/62001FS03\/[^<"\s]+\.(?:jpg|img)/gi);
      if (imageUrls) {
        console.log(`[TRANSFORM] Validating ${imageUrls.length} image URLs for normal container...`);
        imageUrls.slice(0, 3).forEach((url, idx) => {
          console.log(`   [URL ${idx + 1}] ${url}`);
        });
      }
    }
    
    // Gunakan CDATA untuk wrap konten IMGTYPE (karena berisi XML/HTML)
    imgtypeContent = `<![CDATA[${adjustedImgtype}]]>`;
  } else {
    console.log(`[TRANSFORM] ⚠️ No IMGTYPE content found`);
  }

  // Extract SCANIMG entries dari submitted XML
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
  
  // Build SCANIMG section untuk server format
  let scanImgSection = '';
  scanImgBlocks.forEach((img, index) => {
    scanImgSection += `<SCANIMG><TYPE>${img.type}</TYPE><PATH>${img.path}</PATH><ENTRY_ID>${img.entryId}</ENTRY_ID><OPERATETIME>${img.operateTime}</OPERATETIME></SCANIMG>`;
    console.log(`   [${index + 1}] ${img.type}: ${img.entryId} -> ${img.path}`);
  });
  
  // Generate GROUP_ID yang unik (gunakan PICNO karena sudah unik)
  const groupId = picno;
  
  // Build XML baru sesuai format yang diterima server
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

  console.log(`[TRANSFORM] ✅ Transformation completed successfully`);
  console.log(`[TRANSFORM] Final summary:`);
  console.log(`   - PICNO: ${picno}`);
  console.log(`   - Container: ${correctContainerNo}`);
  console.log(`   - Base path: ${correctBasePath}`);
  console.log(`   - SCANIMG entries: ${scanImgBlocks.length}`);
  console.log(`   - Split container: ${splitFolder ? `Yes (${splitFolder})` : 'No'}`);
  
  return transformedXML;
};

/**
 * Generate ftp_path sesuai dengan lokasi file
 */
const getFtpPath = (filePath) => {
  try {
    const relativePath = path.dirname(path.relative(WATCH_PATH, filePath));
    const basePath = '/import/62001FS03';
    
    // Normalize path (ganti backslash dengan forward slash)
    let ftpPath = `${basePath}/${relativePath.replace(/\\/g, '/')}/`;
    
    console.log(`[FTP_PATH] Generated: ${ftpPath}`);
    return ftpPath;
  } catch (error) {
    console.error(`[FTP_PATH] Error generating path: ${error.message}`);
    return '/import/62001FS03/';
  }
};

/**
 * Extract data penting dari XML
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
 * Fungsi utama untuk memproses dan mengirim XML ke server
 */
const processAndSendXml = async (filePath) => {
  try {
    console.log(`\n[PROCESS] 📄 Processing file: ${path.basename(filePath)}`);
    console.log(`[PROCESS] Full path: ${filePath}`);
    
    // STEP 1: Baca dan validasi XML
    const { content: xmlContent, isValid, isSubmittedXML, isInitialXML } = readAndValidateXml(filePath);
    console.log(`[READ] ✅ Successfully read ${xmlContent.length} characters`);
    
    // STEP 2: Extract data dari XML
    const xmlData = extractXmlData(xmlContent);
    console.log(`[DATA] Extracted information:`);
    console.log(`   - PICNO: ${xmlData.picno || '❌ NOT FOUND'}`);
    console.log(`   - Container: ${xmlData.container || '❌ NOT FOUND'}`);
    console.log(`   - Device: ${xmlData.deviceNo || '❌ NOT FOUND'}`);
    
    // Validasi PICNO (wajib ada)
    if (!xmlData.picno) {
      console.error(`[ERROR] ❌ CRITICAL: PICNO not found in XML - cannot proceed`);
      return false;
    }
    
    if (!isValid) {
      console.log(`\n[WARNING] ⚠️ XML structure incomplete, but will attempt to process...`);
    }
    
    // STEP 3: Transform XML jika ini adalah submitted XML
    let finalXmlContent = xmlContent;
    let correctBasePath = '';
    let correctContainerNo = '';
    
    if (isSubmittedXML) {
      console.log(`\n[INFO] 🔄 Detected SUBMITTED XML - transforming to server format...`);
      
      // Extract info sebelum transformasi untuk validasi
      const pathMatch = xmlContent.match(/<PATH>([^<]+)<\/PATH>/);
      correctBasePath = pathMatch ? pathMatch[1] : '';
      
      const inputInfoMatch = xmlContent.match(/<IDR_SII_INPUTINFO_CONTAINER>[\s\S]*?<container_no>([^<]+)<\/container_no>[\s\S]*?<\/IDR_SII_INPUTINFO_CONTAINER>/);
      correctContainerNo = inputInfoMatch ? inputInfoMatch[1] : (xmlContent.match(/<container_no>([^<]+)<\/container_no>/) || [])[1];
      
      console.log(`[ORIGINAL XML] Base path: ${correctBasePath}`);
      console.log(`[ORIGINAL XML] Container: ${correctContainerNo}`);
      
      // Deteksi split container dari base path
      const splitFolderMatch = correctBasePath.match(/\/(\d{3})\/?$/);
      const splitFolder = splitFolderMatch ? splitFolderMatch[1] : null;
      
      if (splitFolder) {
        console.log(`[SPLIT DETECTION] ✅ This is a SPLIT container - Folder: ${splitFolder}`);
      } else {
        console.log(`[SPLIT DETECTION] ℹ️ This is a NORMAL container`);
      }
      
      // Lakukan transformasi
      finalXmlContent = transformSubmittedXML(xmlContent, xmlData.picno, filePath);
      
      // STEP 4: Validasi hasil transformasi
      console.log(`\n[VALIDATION] 🔍 Checking transformed XML...`);
      
      // Cek path dalam IMGTYPE
      const pathInImgtype = finalXmlContent.match(/http:\/\/192\.111\.111\.80:6688\/62001FS03\/[^<"\s]+\.(?:jpg|img)/gi);
      if (pathInImgtype) {
        console.log(`[VALIDATION] Found ${pathInImgtype.length} image paths in IMGTYPE`);
        console.log(`[VALIDATION] Sample paths (first 5):`);
        pathInImgtype.slice(0, 5).forEach((imgPath, index) => {
          console.log(`   ${index + 1}. ${imgPath}`);
        });
        if (pathInImgtype.length > 5) {
          console.log(`   ... and ${pathInImgtype.length - 5} more paths`);
        }
        
        // Validasi khusus untuk split container
        if (splitFolder) {
          const incorrectPaths = pathInImgtype.filter(path => !path.includes(`/${splitFolder}/`));
          if (incorrectPaths.length > 0) {
            console.log(`[VALIDATION] ⚠️ WARNING: ${incorrectPaths.length} paths may not have correct split folder`);
            incorrectPaths.slice(0, 3).forEach((path, idx) => {
              console.log(`   [INCORRECT ${idx + 1}] ${path}`);
            });
          } else {
            console.log(`[VALIDATION] ✅ All image paths correctly include split folder /${splitFolder}/`);
          }
        }
      }
      
      // Validasi container number consistency
      const transformedContainerMatch = finalXmlContent.match(/<container_no>([^<]+)<\/container_no>/);
      const transformedContainer = transformedContainerMatch ? transformedContainerMatch[1] : '';
      const containerCorrect = transformedContainer === correctContainerNo;
      
      console.log(`[VALIDATION] Container consistency: Original="${correctContainerNo}" vs Transformed="${transformedContainer}" ${containerCorrect ? '✅' : '❌'}`);
      
      // Validasi critical tags
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
      
      console.log(`[VALIDATION] Critical checks:`);
      Object.entries(criticalChecks).forEach(([check, result]) => {
        console.log(`   ${result ? '✅' : '❌'} ${check}`);
      });
      
      // Stop jika ada masalah critical
      if (!criticalChecks['Container Consistency']) {
        console.error(`[ERROR] ❌ CRITICAL: Container number mismatch - stopping`);
        return false;
      }
      
      // Validasi PICNO consistency
      if (!finalXmlContent.includes(`<PICNO>${xmlData.picno}</PICNO>`)) {
        console.error(`[ERROR] ❌ CRITICAL: PICNO mismatch in transformed XML - stopping`);
        return false;
      }
      
      console.log(`[VALIDATION] ✅ All validations passed`);
    } else {
      console.log(`\n[INFO] ℹ️ Initial/Direct XML detected - using as-is (no transformation needed)`);
    }
    
    // STEP 5: Prepare payload
    const ftpPath = getFtpPath(filePath);
    const payload = {
      ftp_path: ftpPath,
      image_msg: finalXmlContent
    };
    
    console.log(`\n[PAYLOAD] 📦 Preparing payload...`);
    console.log(`[PAYLOAD] ftp_path: ${ftpPath}`);
    console.log(`[PAYLOAD] image_msg length: ${finalXmlContent.length} characters`);
    console.log(`[PAYLOAD] XML type: ${isSubmittedXML ? 'TRANSFORMED' : 'ORIGINAL'}`);
    
    // STEP 6: Send to server
    console.log(`\n[SEND] 🚀 Sending data to server...`);
    console.log(`[SEND] URL: ${POST_URL}`);
    
    const response = await axios.post(POST_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    
    // STEP 7: Handle response
    console.log(`\n[RESPONSE] HTTP Status: ${response.status}`);
    
    if (response.data && response.data.resultCode === true) {
      console.log(`[RESPONSE] ✅ SUCCESS!`);
      console.log(`[RESPONSE] Message: ${response.data.resultDesc || 'Data processed successfully'}`);
      if (response.data.resultData) {
        const dataPreview = JSON.stringify(response.data.resultData).substring(0, 200);
        console.log(`[RESPONSE] Data preview: ${dataPreview}${dataPreview.length >= 200 ? '...' : ''}`);
      }
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`✅ File processed successfully: ${path.basename(filePath)}`);
      console.log(`${'═'.repeat(60)}\n`);
      return true;
    } else {
      console.log(`[RESPONSE] ❌ FAILED`);
      console.log(`[RESPONSE] Error: ${response.data?.resultDesc || 'Unknown error'}`);
      
      // Detailed error analysis
      if (response.data?.resultDesc) {
        console.log(`\n[ERROR ANALYSIS] 🔍 Analyzing error...`);
        
        if (response.data.resultDesc.includes('Container Tidak Terbaca')) {
          console.log(`   💡 Issue: Container number not readable`);
          console.log(`   💡 Container in XML: "${correctContainerNo}"`);
          console.log(`   💡 Suggestion: Check if container number format is correct`);
        }
        
        if (response.data.resultDesc.includes('Format Input Parameter')) {
          console.log(`   💡 Issue: Invalid input parameter format`);
          console.log(`   💡 Likely cause: Missing or malformed required XML tags`);
          console.log(`   💡 Suggestion: Check XML structure matches server requirements`);
        }
        
        if (response.data.resultDesc.toLowerCase().includes('image')) {
          console.log(`   💡 Issue: Image-related problem`);
          console.log(`   💡 Possible causes:`);
          console.log(`      - Image files not found at specified paths`);
          console.log(`      - Incorrect image paths in IMGTYPE`);
          console.log(`      - Path mismatch for split container`);
          console.log(`   💡 Base path: ${correctBasePath}`);
        }
      }
      
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`❌ File processing failed: ${path.basename(filePath)}`);
      console.log(`${'═'.repeat(60)}\n`);
      return false;
    }
    
  } catch (error) {
    console.log(`\n[ERROR] 💥 Exception occurred during processing`);
    
    if (error.response) {
      console.error(`[ERROR] Server responded with error`);
      console.error(`[ERROR] HTTP Status: ${error.response.status}`);
      console.error(`[ERROR] Response data: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`[ERROR] Connection error - no response from server`);
      console.error(`[ERROR] Details: ${error.message}`);
      console.error(`[ERROR] Check if server is reachable at: ${POST_URL}`);
    } else {
      console.error(`[ERROR] Processing error: ${error.message}`);
      console.error(`[ERROR] Stack trace: ${error.stack}`);
    }
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`❌ File processing error: ${path.basename(filePath)}`);
    console.log(`${'═'.repeat(60)}\n`);
    return false;
  }
};

// ========================================
// INITIALIZE FILE WATCHER
// ========================================
console.log(`\n[WATCHER] 👀 Initializing file watcher...`);

const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,
  ignoreInitial: true,
  recursive: true,
  usePolling: true,
  interval: 3000,
  ignored: /(^|[/\\])\../ // Ignore hidden files
});

// Timer management untuk avoid double processing
const activeTimers = new Map();

watcher.on('add', (filePath) => {
  // Only process XML files
  if (path.extname(filePath).toLowerCase() === '.xml') {
    const fileName = path.basename(filePath);
    
    // Cleanup previous timer if exists (file modified during wait)
    if (activeTimers.has(filePath)) {
      clearTimeout(activeTimers.get(filePath));
      activeTimers.delete(filePath);
      console.log(`[WATCHER] ⚠️ Timer reset for: ${fileName}`);
    }
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[WATCHER] 🔔 New XML file detected!`);
    console.log(`[WATCHER] File: ${fileName}`);
    console.log(`[WATCHER] Path: ${filePath}`);
    console.log(`[WATCHER] Time: ${new Date().toLocaleString('id-ID')}`);
    console.log(`[WATCHER] ⏳ Waiting ${WAIT_TIME_MS / 1000} seconds before processing...`);
    console.log(`${'═'.repeat(60)}`);
    
    // Set new timer
    const timer = setTimeout(async () => {
      console.log(`\n${'█'.repeat(60)}`);
      console.log(`[PROCESS] ⚡ Starting processing: ${fileName}`);
      console.log(`[PROCESS] Wait time completed at: ${new Date().toLocaleString('id-ID')}`);
      console.log(`${'█'.repeat(60)}`);
      
      // Remove from active timers
      activeTimers.delete(filePath);
      
      try {
        // Check if file still exists and is not empty
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
          console.error(`[ERROR] ❌ File is empty (0 bytes) - skipping`);
          return;
        }
        
        console.log(`[PROCESS] File size: ${stats.size} bytes`);
        console.log(`[PROCESS] Last modified: ${stats.mtime.toLocaleString('id-ID')}`);
        
        // Process the XML file
        await processAndSendXml(filePath);
        
      } catch (error) {
        console.error(`[ERROR] ❌ Cannot access or process file`);
        console.error(`[ERROR] Reason: ${error.message}`);
        if (error.code === 'ENOENT') {
          console.error(`[ERROR] File not found - may have been moved or deleted`);
        }
      }
      
      console.log(`${'█'.repeat(60)}\n`);
    }, WAIT_TIME_MS);
    
    activeTimers.set(filePath, timer);
  }
});

// Error handling for watcher
watcher.on('error', (error) => {
  console.error(`\n[WATCHER ERROR] ❌ ${error.message}`);
  console.error(`[WATCHER ERROR] Stack: ${error.stack}`);
});

// Ready event
watcher.on('ready', () => {
  console.log(`[WATCHER] ✅ File watcher is ready and monitoring`);
  console.log(`[WATCHER] Watching path: ${WATCH_PATH}`);
  console.log(`[WATCHER] Recursive: Yes`);
  console.log(`[WATCHER] Polling interval: 3000ms`);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Service is running. Waiting for XML files...`);
  console.log(`   Press Ctrl+C to stop the service`);
  console.log(`${'═'.repeat(60)}\n`);
});

// ========================================
// GRACEFUL SHUTDOWN HANDLER
// ========================================
process.on('SIGINT', () => {
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`[SHUTDOWN] 🛑 Shutdown signal received (Ctrl+C)`);
  console.log(`[SHUTDOWN] Cleaning up...`);
  
  // Clear all active timers
  const timerCount = activeTimers.size;
  activeTimers.forEach((timer) => clearTimeout(timer));
  console.log(`[SHUTDOWN] Cleared ${timerCount} active timer(s)`);
  
  // Close watcher
  watcher.close();
  console.log(`[SHUTDOWN] File watcher closed`);
  
  console.log(`[SHUTDOWN] ✅ Service stopped gracefully`);
  console.log(`[SHUTDOWN] Stopped at: ${new Date().toLocaleString('id-ID')}`);
  console.log(`${'═'.repeat(60)}\n`);
  
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`\n[CRITICAL] 💥 Uncaught Exception!`);
  console.error(`[CRITICAL] Error: ${error.message}`);
  console.error(`[CRITICAL] Stack: ${error.stack}`);
  console.error(`[CRITICAL] Service may need to restart\n`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(`\n[CRITICAL] 💥 Unhandled Promise Rejection!`);
  console.error(`[CRITICAL] Reason: ${reason}`);
  console.error(`[CRITICAL] Promise:`, promise);
  console.error(`[CRITICAL] Service may need to restart\n`);
});

console.log(`[WATCHER] ⏳ Initializing... Please wait...`);