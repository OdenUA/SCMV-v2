// Start/Stop processing
function processStartstopAccumulationServerData(rows) {
  startstopStops = [];
  var cumulative = 0;
  var lastStopCumulative = 0;
  rows.forEach(function (item) {
    var destValue = parseFloat(String(item.dest || "").replace(",", "."));
    if (!isNaN(destValue)) {
      cumulative += destValue;
    }
    if (item.rcls === "asstopped") {
      var segmentDest = cumulative - lastStopCumulative;
      startstopStops.push({
        "#": startstopStops.length + 1,
        fdate: item.fdate || "",
        period: item.period || "",
        segment_dest: segmentDest.toFixed(2),
        dest: cumulative.toFixed(2),
        marker: item.marker != null ? item.marker : "",
      });
      lastStopCumulative = cumulative;
    }
  });
}
function renderStartstopStopsTable() {
  if (!startstopAccumulationTbody || !startstopAccumulationThead) {
    return;
  }
  startstopAccumulationThead.innerHTML = "";
  startstopAccumulationTbody.innerHTML = "";
  if (!startstopStops.length) {
    startstopAccumulationTbody.innerHTML = "<tr><td>Нет стоянок</td></tr>";
    return;
  }
  var headers = ["#", "fdate", "period", "segment_dest", "dest", "marker"];
  var trHead = document.createElement("tr");
  headers.forEach(function (h) {
    var th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  startstopAccumulationThead.appendChild(trHead);
  startstopStops.forEach(function (row) {
    var tr = document.createElement("tr");
    headers.forEach(function (h) {
      var td = document.createElement("td");
      td.textContent = row[h] != null ? row[h] : "";
      tr.appendChild(td);
    });
    tr.addEventListener("click", function () {
      if (row.markerRef) {
        var ll = row.markerRef.getLatLng();
        map.setView(ll, Math.max(map.getZoom(), 15));
        setTimeout(function () {
          row.markerRef.openPopup();
        }, 50);
      }
    });
    startstopAccumulationTbody.appendChild(tr);
  });
}
function rebuildStopMarkers() {
  if (!parkingLayerGroup) return;
  parkingLayerGroup.clearLayers(); // Clear the layer group

  if (!startstopStops.length) return;
  startstopStops.forEach(function (stop) {
    var meta = mileageStopCoords[stop.fdate];
    if (!meta || !Array.isArray(meta.coord)) return;
    var period = stop.period || meta.period || "";
    var isShort = false;
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(period)) {
      var ps = period.split(":").map(function (n) {
        return parseInt(n, 10);
      });
      var totalMin = ps[0] * 60 + ps[1] + ps[2] / 60;
      isShort = totalMin <= 5;
    }
    var markerHtml = isShort
      ? '<div class="stop-marker stop-marker-short">' + stop["#"] + "</div>"
      : '<div class="stop-marker stop-marker-long">' + stop["#"] + "</div>";
    var icon = L.divIcon({
      className: isShort ? "parking-marker-short" : "parking-marker-long",
      html: markerHtml,
      iconSize: isShort ? [22, 22] : [24, 24],
      iconAnchor: isShort ? [11, 11] : [12, 12],
    });
    var popupTitle = isShort
      ? "Короткая стоянка №" + stop["#"]
      : "Стоянка №" + stop["#"];
    var popupHtml =
      "<b>" +
      popupTitle +
      "</b><br>Начало: " +
      stop.fdate +
      "<br>Длительность: " +
      (period || "-") +
      "<br>Сегмент: " +
      (stop.segment_dest || "-") +
      " км<br>Кумулятив: " +
      (stop.dest || "-") +
      " км";
    var marker = L.marker(meta.coord, { icon: icon })
      .addTo(parkingLayerGroup) // Add to the new layer group
      .bindPopup(popupHtml);
    marker._mileageFdate = stop.fdate;
    marker._period = period;
    marker._isShort = isShort;
    marker.on("click", function (ev) {
      if (routeModeActive) {
        var ll = ev.latlng || marker.getLatLng();
        onRouteMapClick({ latlng: ll });
        ev.originalEvent &&
          ev.originalEvent.stopPropagation &&
          ev.originalEvent.stopPropagation();
      } else {
        marker.openPopup();
      }
    });
    // No need to push to parkingMarkers array anymore
    stop.markerRef = marker;
  });
}