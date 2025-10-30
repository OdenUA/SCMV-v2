// reports.js - Reports functionality for SCMV v2

(function() {
  'use strict';

  // Global variables for report generation
  var reportInProgress = false;
  var reportData = {};
  var pendingRequests = {}; // Map request key to metadata

  // Initialize reports functionality
  window.initReports = function() {
    var reportsBtn = document.getElementById('reportsBtn');
    var reportsOverlay = document.getElementById('reportsOverlay');
    var closeReportsOverlay = document.getElementById('closeReportsOverlay');
    var generateReportBtn = document.getElementById('generateReportBtn');

    if (reportsBtn) {
      reportsBtn.addEventListener('click', function() {
        if (reportsOverlay) {
          reportsOverlay.style.display = 'block';
          // Set default month to current month
          var now = new Date();
          var monthInput = document.getElementById('reportMonth');
          if (monthInput && !monthInput.value) {
            var year = now.getFullYear();
            var month = String(now.getMonth() + 1).padStart(2, '0');
            monthInput.value = year + '-' + month;
          }
        }
      });
    }

    if (closeReportsOverlay) {
      closeReportsOverlay.addEventListener('click', function() {
        if (reportsOverlay) {
          reportsOverlay.style.display = 'none';
        }
      });
    }

    if (generateReportBtn) {
      generateReportBtn.addEventListener('click', function() {
        generateReport();
      });
    }

    // Register handler for Startstop Sum Result responses
    if (!window.__handleReportResponse) {
      window.__handleReportResponse = function(data) {
        if (reportInProgress && data && data.name === 'Startstop Sum Result') {
          handleMileageResponse(data);
          return true; // Mark as handled
        }
        return false;
      };
    }
  };

  // Parse device IDs from textarea (comma, space, tab, semicolon, newline separated)
  function parseDeviceIds(text) {
    if (!text || typeof text !== 'string') return [];
    
    // Replace all delimiters with comma, then split
    var normalized = text.replace(/[\s,;\t\n\r]+/g, ',');
    var parts = normalized.split(',');
    var ids = [];
    
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part && part.length > 0) {
        ids.push(part);
      }
    }
    
    return ids;
  }

  // Generate array of dates for given month
  function generateMonthDates(year, month) {
    var dates = [];
    var daysInMonth = new Date(year, month, 0).getDate();
    
    for (var day = 1; day <= daysInMonth; day++) {
      dates.push({
        year: year,
        month: month,
        day: day,
        dateObj: new Date(year, month - 1, day)
      });
    }
    
    return dates;
  }

  // Format date for SQL (YYYY-MM-DD HH:mm:ss)
  function formatDateForSql(year, month, day, hour, minute, second) {
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return year + '-' + pad(month) + '-' + pad(day) + ' ' + 
           pad(hour) + ':' + pad(minute) + ':' + pad(second);
  }

  // Main report generation function
  function generateReport() {
    if (reportInProgress) {
      showRouteToast('⚠ Отчет уже формируется...');
      return;
    }

    var reportType = document.getElementById('reportTypeSelect').value;
    
    if (reportType === 'monthly-mileage') {
      generateMonthlyMileageReport();
    }
  }

  // Generate monthly mileage report
  function generateMonthlyMileageReport() {
    var deviceIdsText = document.getElementById('reportDeviceIds').value;
    var monthValue = document.getElementById('reportMonth').value;

    // Validate inputs
    if (!deviceIdsText || deviceIdsText.trim().length === 0) {
      showRouteToast('⚠ Укажите хотя бы один ID устройства');
      return;
    }

    if (!monthValue) {
      showRouteToast('⚠ Выберите месяц');
      return;
    }

    var deviceIds = parseDeviceIds(deviceIdsText);
    if (deviceIds.length === 0) {
      showRouteToast('⚠ Не удалось распознать ID устройств');
      return;
    }

    // Parse month (format: YYYY-MM)
    var monthParts = monthValue.split('-');
    if (monthParts.length !== 2) {
      showRouteToast('⚠ Неверный формат месяца');
      return;
    }

    var year = parseInt(monthParts[0], 10);
    var month = parseInt(monthParts[1], 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      showRouteToast('⚠ Неверный месяц');
      return;
    }

    // Generate dates for the month
    var dates = generateMonthDates(year, month);

    // Initialize report data structure
    reportData = {
      deviceIds: deviceIds,
      dates: dates,
      year: year,
      month: month,
      mileage: {}, // Structure: mileage[deviceId][dateKey] = value
      pending: 0,
      total: deviceIds.length * dates.length
    };

    // Initialize mileage object
    for (var i = 0; i < deviceIds.length; i++) {
      reportData.mileage[deviceIds[i]] = {};
    }

    // Show progress
    reportInProgress = true;
    showReportProgress(0, reportData.total);

    // Send requests for each device and each date
    showRouteToast('📊 Начинаем формирование отчета...');
    
    for (var d = 0; d < deviceIds.length; d++) {
      for (var dt = 0; dt < dates.length; dt++) {
        sendMileageRequest(deviceIds[d], dates[dt]);
      }
    }
  }

  // Send single mileage request for one device and one day
  function sendMileageRequest(deviceId, dateInfo) {
    var dateFrom = formatDateForSql(dateInfo.year, dateInfo.month, dateInfo.day, 0, 0, 0);
    var dateTo = formatDateForSql(dateInfo.year, dateInfo.month, dateInfo.day, 23, 59, 59);

    var request = {
      name: 'Startstop Sum Result',
      type: 'etbl',
      mid: 6,
      act: 'filter',
      filter: [
        { selecteduid: [authUid] },
        { selectedvihicleid: [deviceId] },
        { selectedpgdatefrom: [dateFrom] },
        { selectedpgdateto: [dateTo] }
      ],
      usr: authUser,
      pwd: authPwd,
      uid: authUid,
      lang: 'en'
    };

    var dateKey = dateInfo.year + '-' + String(dateInfo.month).padStart(2, '0') + '-' + String(dateInfo.day).padStart(2, '0');
    
    // Store request metadata using a key
    var requestKey = deviceId + '|' + dateKey;
    pendingRequests[requestKey] = {
      deviceId: deviceId,
      dateKey: dateKey,
      dateFrom: dateFrom,
      dateTo: dateTo
    };

    reportData.pending++;
    sendRequest(request);
  }

  // Handle response from Startstop Sum Result
  function handleMileageResponse(data) {
    // Try to match response to pending request
    // Extract device ID and date from response filter
    var deviceId = null;
    var dateFrom = null;
    var dateTo = null;

    try {
      if (data.filter && Array.isArray(data.filter)) {
        for (var i = 0; i < data.filter.length; i++) {
          var f = data.filter[i];
          if (f.selectedvihicleid && Array.isArray(f.selectedvihicleid)) {
            deviceId = f.selectedvihicleid[0];
          }
          if (f.selectedpgdatefrom && Array.isArray(f.selectedpgdatefrom)) {
            dateFrom = f.selectedpgdatefrom[0];
          }
          if (f.selectedpgdateto && Array.isArray(f.selectedpgdateto)) {
            dateTo = f.selectedpgdateto[0];
          }
        }
      }
    } catch (e) {
      console.warn('Error extracting filter from response:', e);
    }

    // Find matching pending request
    var metadata = null;
    var requestKey = null;

    if (deviceId && dateFrom) {
      // Extract date from dateFrom (YYYY-MM-DD HH:mm:ss -> YYYY-MM-DD)
      var datePart = dateFrom.split(' ')[0];
      requestKey = deviceId + '|' + datePart;
      metadata = pendingRequests[requestKey];
    }

    if (!metadata) {
      // Try all pending requests
      var keys = Object.keys(pendingRequests);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var meta = pendingRequests[key];
        if (meta.dateFrom === dateFrom && meta.dateTo === dateTo) {
          metadata = meta;
          requestKey = key;
          break;
        }
      }
    }

    if (!metadata) {
      // Not our request
      return;
    }

    // Remove from pending
    delete pendingRequests[requestKey];

    var dateKey = metadata.dateKey;
    deviceId = metadata.deviceId;

    // Extract mileage value
    var mileageValue = 0;
    try {
      if (data.res && data.res[0] && data.res[0].f && data.res[0].f[0]) {
        var destValue = data.res[0].f[0].dest;
        if (destValue) {
          // destValue is like "12384,68" (comma as decimal separator)
          var normalized = String(destValue).replace(',', '.');
          mileageValue = parseFloat(normalized);
          if (isNaN(mileageValue)) {
            mileageValue = 0;
          }
        }
      }
    } catch (e) {
      console.warn('Error parsing mileage:', e);
    }

    // Store mileage
    if (reportData.mileage[deviceId]) {
      reportData.mileage[deviceId][dateKey] = mileageValue;
    }

    reportData.pending--;

    // Update progress
    var completed = reportData.total - reportData.pending;
    showReportProgress(completed, reportData.total);

    // Check if all requests completed
    if (reportData.pending === 0) {
      finalizeMileageReport();
    }
  }

  // Show progress bar
  function showReportProgress(current, total) {
    var statusDiv = document.getElementById('reportStatus');
    var progressText = document.getElementById('reportProgress');
    var progressFill = document.getElementById('reportProgressFill');

    if (statusDiv) {
      statusDiv.style.display = 'block';
    }

    if (progressText) {
      progressText.textContent = 'Обработано: ' + current + ' из ' + total;
    }

    if (progressFill) {
      var percent = total > 0 ? (current / total * 100) : 0;
      progressFill.style.width = percent + '%';
    }
  }

  // Finalize and export mileage report
  function finalizeMileageReport() {
    showRouteToast('✅ Отчет сформирован!');

    // Build XLS data
    var xlsData = buildMileageXlsData();

    // Export to XLS
    exportMileageReport(xlsData);

    // Reset
    reportInProgress = false;
    
    // Hide progress after a delay
    setTimeout(function() {
      var statusDiv = document.getElementById('reportStatus');
      if (statusDiv) {
        statusDiv.style.display = 'none';
      }
    }, 3000);
  }

  // Build XLS data array
  function buildMileageXlsData() {
    var data = [];
    
    // Header row: "Дата/Авто" + device IDs
    var header = ['Дата/Авто'];
    for (var i = 0; i < reportData.deviceIds.length; i++) {
      header.push(reportData.deviceIds[i]);
    }
    data.push(header);

    // Data rows: one per date
    for (var d = 0; d < reportData.dates.length; d++) {
      var dateInfo = reportData.dates[d];
      var dateKey = dateInfo.year + '-' + 
                    String(dateInfo.month).padStart(2, '0') + '-' + 
                    String(dateInfo.day).padStart(2, '0');
      
      // Format date as DD.MM.YYYY for display
      var displayDate = String(dateInfo.day).padStart(2, '0') + '.' + 
                        String(dateInfo.month).padStart(2, '0') + '.' + 
                        dateInfo.year;
      
      var row = [displayDate];
      
      // Add mileage for each device
      for (var dev = 0; dev < reportData.deviceIds.length; dev++) {
        var deviceId = reportData.deviceIds[dev];
        var mileage = reportData.mileage[deviceId][dateKey];
        
        if (typeof mileage === 'number') {
          // Format as string with comma decimal separator
          row.push(mileage.toFixed(2).replace('.', ','));
        } else {
          row.push('');
        }
      }
      
      data.push(row);
    }

    return data;
  }

  // Export mileage report to XLS file
  function exportMileageReport(xlsData) {
    if (typeof XLSX === 'undefined') {
      showRouteToast('⚠ XLSX библиотека не загружена');
      console.error('XLSX library not loaded');
      return;
    }

    try {
      // Create workbook
      var wb = XLSX.utils.book_new();
      
      // Create worksheet from data
      var ws = XLSX.utils.aoa_to_sheet(xlsData);
      
      // Add worksheet to workbook
      var monthName = getMonthName(reportData.month);
      var sheetName = monthName + ' ' + reportData.year;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      
      // Generate filename
      var filename = 'Пробег_' + monthName + '_' + reportData.year + '.xlsx';
      
      // Save file
      XLSX.writeFile(wb, filename);
      
      showRouteToast('📥 Отчет экспортирован: ' + filename);
    } catch (e) {
      showRouteToast('⚠ Ошибка экспорта: ' + e.message);
      console.error('Export error:', e);
    }
  }

  // Get Russian month name
  function getMonthName(month) {
    var months = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];
    return months[month - 1] || 'Месяц' + month;
  }

  // Initialize on document ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReports);
  } else {
    initReports();
  }

})();
