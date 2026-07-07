// Alert Zones: draw, save, and monitor geographic alert zones on the ADS-B map.
// Depends on: OLMap, ol (OpenLayers 6). PlaneTrackerURL is optional.
'use strict';

var AlertZoneSource  = new ol.source.Vector();
var PredTrackSource  = new ol.source.Vector();
var AlertZoneLayer   = null;
var PredTrackLayer   = null;

var _azZones           = [];
var _azAlerts          = [];
var _azDrawInteraction = null;
var _pendingCoords     = null;

var _AZ_API_BASE =
    (typeof PlaneTrackerURL !== 'undefined' ? PlaneTrackerURL : window.location.origin) +
    '/api/alert_zones';

function initAlertZones() {
    AlertZoneLayer = new ol.layer.Vector({
        source: AlertZoneSource,
        style:  _azZoneStyle,
        zIndex: 10,
    });
    PredTrackLayer = new ol.layer.Vector({
        source: PredTrackSource,
        zIndex: 9,
        style: new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: '#ff5722', width: 2, lineDash: [8, 4],
            }),
        }),
    });
    OLMap.addLayer(PredTrackLayer);
    OLMap.addLayer(AlertZoneLayer);

    _azInjectStyles();
    _azBuildPanel();
    _azBuildNameDialog();

    _azLoadZones();
    setInterval(_azPollAlerts, 5000);
    _azPollAlerts();
}

function _azZoneStyle(feature) {
    var color   = feature.get('color') || '#e53935';
    var enabled = feature.get('enabled') !== false;
    var rgb     = _azHexRgb(color);
    return new ol.style.Style({
        fill: new ol.style.Fill({
            color: enabled
                ? 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.15)'
                : 'rgba(150,150,150,0.08)',
        }),
        stroke: new ol.style.Stroke({
            color:    enabled ? color : '#777',
            width:    enabled ? 2 : 1,
            lineDash: enabled ? undefined : [6, 4],
        }),
    });
}

function _azInjectStyles() {
    var s = document.createElement('style');
    s.textContent = [
        '.az-panel{position:fixed;right:10px;top:60px;width:270px;background:#1e1e2e;',
        'color:#e0e0e0;border:1px solid #444;border-radius:6px;z-index:1000;',
        'box-shadow:0 4px 16px rgba(0,0,0,.5);font-size:13px;font-family:sans-serif;}',
        '.az-panel-hdr{display:flex;justify-content:space-between;align-items:center;',
        'padding:8px 12px;background:#2a2a3e;border-radius:6px 6px 0 0;',
        'font-weight:bold;font-size:14px;}',
        '.az-x-btn{background:none;border:none;color:#aaa;cursor:pointer;font-size:16px;padding:0 4px;}',
        '.az-body{padding:10px;}',
        '.az-draw-row{display:flex;gap:6px;margin-bottom:8px;}',
        '.az-btn{flex:1;padding:5px 8px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;}',
        '.az-btn-draw{background:#2e7d32;color:#fff;}',
        '.az-btn-draw:hover{background:#388e3c;}',
        '.az-btn-cancel{background:#b71c1c;color:#fff;}',
        '.az-btn-cancel:hover{background:#c62828;}',
        '.az-hint{text-align:center;padding:5px;background:#2a2a3e;border-radius:4px;',
        'margin-bottom:8px;font-size:11px;color:#aaa;}',
        '.az-zone-list{max-height:180px;overflow-y:auto;margin-bottom:6px;}',
        '.az-zone-item{display:flex;align-items:center;gap:5px;padding:5px 2px;',
        'border-bottom:1px solid #2a2a3e;}',
        '.az-zone-item.az-off{opacity:.5;}',
        '.az-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}',
        '.az-zone-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;}',
        '.az-icon-btn{background:none;border:1px solid #555;border-radius:3px;',
        'color:#ccc;cursor:pointer;font-size:11px;padding:1px 5px;}',
        '.az-icon-btn:hover{background:#333;}',
        '.az-del{color:#ff5555;}',
        '.az-empty{color:#666;font-size:12px;text-align:center;padding:10px 0;}',
        '.az-alerts{margin-top:6px;}',
        '.az-alert-hdr{font-size:11px;font-weight:bold;color:#ff9800;margin-bottom:4px;}',
        '.az-alert-item{padding:3px 0;font-size:12px;border-bottom:1px solid #2a2a3e;}',
        '.az-acs{color:#fff;font-weight:bold;}',
        '.az-azone{color:#e53935;}',
        '.az-aeta{color:#777;font-size:11px;}',
        '.az-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
        'background:#1e1e2e;border:1px solid #555;border-radius:8px;z-index:2000;',
        'padding:20px;min-width:250px;box-shadow:0 8px 24px rgba(0,0,0,.7);}',
        '.az-dialog-title{font-weight:bold;margin-bottom:12px;font-size:14px;}',
        '.az-dialog input[type=text]{width:100%;box-sizing:border-box;padding:6px 8px;',
        'background:#2a2a3e;border:1px solid #555;border-radius:4px;',
        'color:#e0e0e0;font-size:13px;margin-bottom:8px;}',
        '.az-color-row{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;}',
        '.az-dialog-btns{display:flex;gap:8px;}',
        '.az-dialog-btns button{flex:1;padding:7px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;}',
        '.az-save-btn{background:#2e7d32;color:#fff;}',
        '.az-save-btn:hover{background:#388e3c;}',
        '.az-disc-btn{background:#333;color:#ccc;}',
        '.az-disc-btn:hover{background:#444;}',
        '.az-hidden{display:none!important;}',
    ].join('');
    document.head.appendChild(s);
}

function _azBuildPanel() {
    var d = document.createElement('div');
    d.id = 'az-panel';
    d.className = 'az-panel az-hidden';
    d.innerHTML =
        '<div class="az-panel-hdr">' +
            '<span>&#9651; Alert Zones</span>' +
            '<button class="az-x-btn" onclick="azTogglePanel()">&#10005;</button>' +
        '</div>' +
        '<div class="az-body">' +
            '<div class="az-draw-row">' +
                '<button id="az-draw-btn" class="az-btn az-btn-draw" onclick="azStartDraw()">&#9998; Draw Zone</button>' +
                '<button id="az-cancel-btn" class="az-btn az-btn-cancel az-hidden" onclick="azCancelDraw()">Cancel</button>' +
            '</div>' +
            '<div id="az-hint" class="az-hint az-hidden">Click to add vertices &mdash; double-click to finish</div>' +
            '<div id="az-zone-list" class="az-zone-list"></div>' +
            '<div id="az-alerts" class="az-alerts"></div>' +
        '</div>';
    document.body.appendChild(d);
}

function _azBuildNameDialog() {
    var d = document.createElement('div');
    d.id = 'az-dialog';
    d.className = 'az-dialog az-hidden';
    d.innerHTML =
        '<div class="az-dialog-title">Name this zone</div>' +
        '<input id="az-zone-name" type="text" placeholder="e.g. Approach corridor" />' +
        '<div class="az-color-row">Color: <input id="az-zone-color" type="color" value="#e53935" /></div>' +
        '<div class="az-dialog-btns">' +
            '<button class="az-save-btn" onclick="azSaveZone()">Save</button>' +
            '<button class="az-disc-btn" onclick="azDiscardZone()">Discard</button>' +
        '</div>';
    document.body.appendChild(d);
}

function azTogglePanel() {
    var p = document.getElementById('az-panel');
    if (p) p.classList.toggle('az-hidden');
}

function azStartDraw() {
    if (_azDrawInteraction) OLMap.removeInteraction(_azDrawInteraction);

    _azDrawInteraction = new ol.interaction.Draw({ type: 'Polygon' });
    _azDrawInteraction.on('drawend', function(evt) {
        var ring = evt.feature.getGeometry().getCoordinates()[0];
        _pendingCoords = ring.map(function(c) {
            var ll = ol.proj.toLonLat(c);
            return [ll[1], ll[0]];
        });
        OLMap.removeInteraction(_azDrawInteraction);
        _azDrawInteraction = null;
        _azSetDrawMode(false);
        document.getElementById('az-zone-name').value = '';
        document.getElementById('az-dialog').classList.remove('az-hidden');
    });

    OLMap.addInteraction(_azDrawInteraction);
    _azSetDrawMode(true);
}

function azCancelDraw() {
    if (_azDrawInteraction) {
        OLMap.removeInteraction(_azDrawInteraction);
        _azDrawInteraction = null;
    }
    _pendingCoords = null;
    _azSetDrawMode(false);
}

function _azSetDrawMode(on) {
    var draw   = document.getElementById('az-draw-btn');
    var cancel = document.getElementById('az-cancel-btn');
    var hint   = document.getElementById('az-hint');
    if (!draw) return;
    if (on) {
        draw.classList.add('az-hidden');
        cancel.classList.remove('az-hidden');
        hint.classList.remove('az-hidden');
    } else {
        draw.classList.remove('az-hidden');
        cancel.classList.add('az-hidden');
        hint.classList.add('az-hidden');
    }
}

function azSaveZone() {
    if (!_pendingCoords || _pendingCoords.length < 3) return;
    var name  = (document.getElementById('az-zone-name').value || '').trim() || 'Zone';
    var color = document.getElementById('az-zone-color').value || '#e53935';

    fetch(_AZ_API_BASE, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: name, coords: _pendingCoords, color: color, enabled: true }),
    })
    .then(function(r) { return r.json(); })
    .then(function() {
        _pendingCoords = null;
        document.getElementById('az-dialog').classList.add('az-hidden');
        _azLoadZones();
    })
    .catch(function(e) { console.error('az save failed', e); });
}

function azDiscardZone() {
    _pendingCoords = null;
    document.getElementById('az-dialog').classList.add('az-hidden');
}

function azToggleZone(id) {
    var zone = _azZones.find(function(z) { return z.id === id; });
    if (!zone) return;
    fetch(_AZ_API_BASE + '/' + id, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled: zone.enabled === false }),
    }).then(function() { _azLoadZones(); });
}

function azDeleteZone(id) {
    if (!confirm('Delete this zone?')) return;
    fetch(_AZ_API_BASE + '/' + id, { method: 'DELETE' })
        .then(function() { _azLoadZones(); });
}

function _azLoadZones() {
    fetch(_AZ_API_BASE)
    .then(function(r) { return r.json(); })
    .then(function(zones) {
        _azZones = zones;
        _azRenderOnMap();
        _azRenderList();
    })
    .catch(function(e) { console.error('az load failed', e); });
}

function _azRenderOnMap() {
    AlertZoneSource.clear();
    _azZones.forEach(function(zone) {
        var ring = zone.coords.map(function(c) {
            return ol.proj.fromLonLat([c[1], c[0]]);
        });
        if (ring.length > 1) {
            var f = ring[0], l = ring[ring.length - 1];
            if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
        }
        AlertZoneSource.addFeature(new ol.Feature({
            geometry: new ol.geom.Polygon([ring]),
            color:    zone.color || '#e53935',
            enabled:  zone.enabled !== false,
            zoneId:   zone.id,
        }));
    });
}

function _azRenderList() {
    var el = document.getElementById('az-zone-list');
    if (!el) return;
    if (!_azZones.length) {
        el.innerHTML = '<div class="az-empty">No zones &mdash; draw one on the map</div>';
        return;
    }
    el.innerHTML = _azZones.map(function(z) {
        var off = z.enabled === false ? ' az-off' : '';
        return '<div class="az-zone-item' + off + '">' +
            '<span class="az-dot" style="background:' + _azEsc(z.color || '#e53935') + '"></span>' +
            '<span class="az-zone-name">' + _azEsc(z.name) + '</span>' +
            '<button class="az-icon-btn" onclick="azToggleZone(\'' + z.id + '\')">' +
                (z.enabled !== false ? 'Off' : 'On') + '</button>' +
            '<button class="az-icon-btn az-del" onclick="azDeleteZone(\'' + z.id + '\')" title="Delete">&#10005;</button>' +
        '</div>';
    }).join('');
}

function _azPollAlerts() {
    fetch(_AZ_API_BASE + '/alerts')
    .then(function(r) { return r.json(); })
    .then(function(data) {
        _azAlerts = data.alerts || [];
        _azRenderAlerts();
        _azRenderTracks(data.tracks || {});
    })
    .catch(function() {});
}

function _azRenderAlerts() {
    var el = document.getElementById('az-alerts');
    if (!el) return;

    var badge = document.getElementById('az-badge');
    if (badge) {
        if (_azAlerts.length) {
            badge.textContent = _azAlerts.length;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    if (!_azAlerts.length) { el.innerHTML = ''; return; }

    el.innerHTML =
        '<div class="az-alert-hdr">&#9888; Predicted to enter:</div>' +
        _azAlerts.map(function(a) {
            var eta = (a.eta_s === 0) ? 'NOW' : 'in ' + a.eta_s + 's';
            return '<div class="az-alert-item">' +
                '<span class="az-acs">' + _azEsc(a.callsign) + '</span>' +
                ' &#8594; ' +
                '<span class="az-azone">' + _azEsc(a.zone_name) + '</span>' +
                ' <span class="az-aeta">(' + eta + ')</span>' +
            '</div>';
        }).join('');
}

function _azRenderTracks(tracks) {
    PredTrackSource.clear();
    var alerted = {};
    _azAlerts.forEach(function(a) { alerted[a.icao] = true; });

    Object.keys(tracks).forEach(function(icao) {
        if (!alerted[icao]) return;
        var path = tracks[icao];
        if (!path || path.length < 2) return;
        PredTrackSource.addFeature(new ol.Feature({
            geometry: new ol.geom.LineString(path.map(function(p) {
                return ol.proj.fromLonLat([p[1], p[0]]);
            })),
        }));
    });
}

function _azHexRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function _azEsc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
