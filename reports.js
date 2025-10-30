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
    } else if (reportType === 'weekly-breakdown') {
      generateWeeklyBreakdownReport();
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

  // Generate weekly breakdown report
  function generateWeeklyBreakdownReport() {
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

    // Split month into weeks
    var weeks = splitIntoWeeks(dates);

    // Initialize report data structure
    reportData = {
      deviceIds: deviceIds,
      dates: dates,
      weeks: weeks,
      year: year,
      month: month,
      mileage: {}, // Structure: mileage[deviceId][dateKey] = value
      pending: 0,
      total: deviceIds.length * dates.length,
      reportType: 'weekly-breakdown'
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

  // Split month dates into weeks
  function splitIntoWeeks(dates) {
    var weeks = [];
    var currentWeek = [];
    
    for (var i = 0; i < dates.length; i++) {
      var dateObj = dates[i].dateObj;
      var dayOfWeek = dateObj.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
      
      // Start new week on Monday
      if (currentWeek.length > 0 && dayOfWeek === 1) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      
      currentWeek.push(dates[i]);
    }
    
    // Add last week
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }
    
    return weeks;
  }

  // Calculate weekly mileage breakdown (weekdays, saturday, sunday)
  function calculateWeeklyBreakdown(deviceId, week) {
    var weekdays = 0; // Monday-Friday
    var saturday = 0;
    var sunday = 0;
    
    for (var i = 0; i < week.length; i++) {
      var dateInfo = week[i];
      var dateKey = dateInfo.year + '-' + 
                    String(dateInfo.month).padStart(2, '0') + '-' + 
                    String(dateInfo.day).padStart(2, '0');
      
      var mileage = reportData.mileage[deviceId][dateKey];
      if (typeof mileage !== 'number') {
        mileage = 0;
      }
      
      var dayOfWeek = dateInfo.dateObj.getDay();
      
      if (dayOfWeek === 0) {
        // Sunday
        sunday += mileage;
      } else if (dayOfWeek === 6) {
        // Saturday
        saturday += mileage;
      } else {
        // Monday-Friday
        weekdays += mileage;
      }
    }
    
    return {
      weekdays: weekdays,
      saturday: saturday,
      sunday: sunday
    };
  }

  // Get vehicle info from vehicleSelectMinData or vehicleShowData
  function getVehicleInfo(deviceId) {
    var vehicleData = window.vehicleShowData || window.vehicleSelectMinData;
    
    if (!vehicleData || !Array.isArray(vehicleData)) {
      return {
        number: '',
        vehicle: '',
        name: ''
      };
    }
    
    var row = vehicleData.find(function(r) {
      if (!r) return false;
      var id = r.id !== undefined ? r.id : r.vehicleid;
      return String(id) === String(deviceId);
    });
    
    if (!row) {
      return {
        number: '',
        vehicle: '',
        name: ''
      };
    }
    
    return {
      number: row.number || row.vehicle || '',
      vehicle: row.vehicle || row.name || '',
      name: row.name || row.drivername || row.driver || ''
    };
  }

  // Finalize and export mileage report
  function finalizeMileageReport() {
    showRouteToast('✅ Отчет сформирован!');

    // Build XLS data based on report type
    var xlsData;
    if (reportData.reportType === 'weekly-breakdown') {
      xlsData = buildWeeklyBreakdownXlsData();
    } else {
      xlsData = buildMileageXlsData();
    }

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
    
    // Header row: "Дата/Авто" + vehicle names (or device IDs if name not found)
    var header = ['Дата/Авто'];
    for (var i = 0; i < reportData.deviceIds.length; i++) {
      var deviceId = reportData.deviceIds[i];
      var vehicleInfo = getVehicleInfo(deviceId);
      
      // Use vehicle number/name, or fallback to device ID
      var vehicleLabel = vehicleInfo.number || vehicleInfo.vehicle || deviceId;
      header.push(vehicleLabel);
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

  // Build weekly breakdown XLS data
  function buildWeeklyBreakdownXlsData() {
    var data = [];
    
    // Header row 1: Main headers
    var header1 = ['№ п/п', 'номерний знак авто', 'марка авто', 'П.І.Б.'];
    for (var w = 0; w < reportData.weeks.length; w++) {
      header1.push((w + 1) + ' тиждень');
      header1.push(''); // суб.
      header1.push(''); // нед
    }
    header1.push('Км');
    header1.push('');
    header1.push('Разом');
    data.push(header1);
    
    // Header row 2: Day types
    var header2 = ['', '', '', ''];
    for (var w = 0; w < reportData.weeks.length; w++) {
      header2.push('будні');
      header2.push('суб.');
      header2.push('нед');
    }
    header2.push('будні');
    header2.push('вихідні');
    header2.push('Км');
    data.push(header2);
    
    // Data rows: one per device
    for (var d = 0; d < reportData.deviceIds.length; d++) {
      var deviceId = reportData.deviceIds[d];
      var vehicleInfo = getVehicleInfo(deviceId);
      
      var row = [];
      row.push(d + 1); // № п/п
      row.push(vehicleInfo.number); // номерний знак
      row.push(vehicleInfo.vehicle); // марка авто
      row.push(vehicleInfo.name); // П.І.Б.
      
      var totalWeekdays = 0;
      var totalWeekends = 0;
      
      // Add data for each week
      for (var w = 0; w < reportData.weeks.length; w++) {
        var week = reportData.weeks[w];
        var breakdown = calculateWeeklyBreakdown(deviceId, week);
        
        row.push(breakdown.weekdays > 0 ? breakdown.weekdays.toFixed(2).replace('.', ',') : '');
        row.push(breakdown.saturday > 0 ? breakdown.saturday.toFixed(2).replace('.', ',') : '');
        row.push(breakdown.sunday > 0 ? breakdown.sunday.toFixed(2).replace('.', ',') : '');
        
        totalWeekdays += breakdown.weekdays;
        totalWeekends += breakdown.saturday + breakdown.sunday;
      }
      
      // Total weekdays
      row.push(totalWeekdays > 0 ? totalWeekdays.toFixed(2).replace('.', ',') : '');
      // Total weekends
      row.push(totalWeekends > 0 ? totalWeekends.toFixed(2).replace('.', ',') : '');
      // Grand total
      var grandTotal = totalWeekdays + totalWeekends;
      row.push(grandTotal > 0 ? grandTotal.toFixed(2).replace('.', ',') : '');
      
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
      
      // Generate filename based on report type
      var filename;
      if (reportData.reportType === 'weekly-breakdown') {
        filename = 'Недельный_пробег_' + monthName + '_' + reportData.year + '.xlsx';
      } else {
        filename = 'Пробег_' + monthName + '_' + reportData.year + '.xlsx';
      }
      
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
