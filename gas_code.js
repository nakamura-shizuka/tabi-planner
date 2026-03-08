// ============================================================
// Tabi Planner - GAS バックエンド
// ============================================================

const SHEET_NAME_TRIPS = '旅行一覧';
const SHEET_NAME_SCHEDULE = 'スケジュール';
const SHEET_NAME_TRANSPORT = '交通手段';

// ------------------------------------------------------------
// Web App エントリーポイント
// ------------------------------------------------------------

function doGet(e) {
    const html = HtmlService.createHtmlOutputFromFile('index')
        .setTitle('Tabi Planner 🗺')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
    return html;
}

function doPost(e) {
    try {
        const params = JSON.parse(e.postData.contents);
        const action = params.action;
        let result;

        switch (action) {
            case 'getTrips': result = getTrips(); break;
            case 'getTripDetail': result = getTripDetail(params.tripId); break;
            case 'saveTrip': result = saveTrip(params.data); break;
            case 'saveSchedule': result = saveScheduleItem(params.data); break;
            case 'saveTransport': result = saveTransport(params.data); break;
            case 'deleteTrip': result = deleteTrip(params.tripId); break;
            case 'deleteSchedule': result = deleteScheduleItem(params.scheduleId); break;
            case 'deleteTransport': result = deleteTransport(params.transportId); break;
            default: result = { success: false, error: 'Unknown action: ' + action };
        }

        return ContentService.createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// ------------------------------------------------------------
// スプレッドシート取得ヘルパー
// ------------------------------------------------------------

function getSpreadsheet() {
    const props = PropertiesService.getScriptProperties();
    const ssId = props.getProperty('SPREADSHEET_ID');
    if (!ssId) throw new Error('SPREADSHEET_IDがスクリプトプロパティに設定されていません');
    return SpreadsheetApp.openById(ssId);
}

function getSheet(name) {
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        initSheetHeaders(sheet, name);
    }
    return sheet;
}

function initSheetHeaders(sheet, name) {
    const headers = {
        [SHEET_NAME_TRIPS]: ['tripId', '旅行名', '開始日', '終了日', 'メモ', '作成日'],
        [SHEET_NAME_SCHEDULE]: ['scheduleId', 'tripId', '日付', '開始時刻', '終了時刻', 'カテゴリ', 'タイトル', '場所', '予約ステータス', 'メモ', '並び順', 'transportId'],
        [SHEET_NAME_TRANSPORT]: ['transportId', 'scheduleId', 'tripId', '出発地', '到着地', '出発時刻', '到着時刻', '路線名', '座席情報', '料金', '優先度', 'GoogleMapsURL', 'メモ']
    };
    if (headers[name]) {
        sheet.appendRow(headers[name]);
        sheet.getRange(1, 1, 1, headers[name].length).setFontWeight('bold').setBackground('#f0f0f0');
        sheet.setFrozenRows(1);
    }
}

function generateId(prefix) {
    return prefix + '_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 5);
}

function sheetToObjects(sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    const headers = data[0];
    return data.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? String(row[i]) : ''; });
        return obj;
    });
}

// ------------------------------------------------------------
// 旅行一覧 CRUD
// ------------------------------------------------------------

function getTrips() {
    try {
        const sheet = getSheet(SHEET_NAME_TRIPS);
        const trips = sheetToObjects(sheet);
        return { success: true, data: trips.reverse() }; // 新しい順
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function saveTrip(data) {
    try {
        const sheet = getSheet(SHEET_NAME_TRIPS);
        const rows = sheet.getDataRange().getValues();
        const now = new Date().toLocaleString('ja-JP');

        if (data.tripId) {
            // 更新
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][0] === data.tripId) {
                    sheet.getRange(i + 1, 1, 1, 6).setValues([[
                        data.tripId, data.旅行名 || '', data.開始日 || '', data.終了日 || '', data.メモ || '', rows[i][5]
                    ]]);
                    return { success: true, tripId: data.tripId };
                }
            }
        }
        // 新規作成
        const tripId = generateId('trip');
        sheet.appendRow([tripId, data.旅行名 || '', data.開始日 || '', data.終了日 || '', data.メモ || '', now]);
        return { success: true, tripId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function deleteTrip(tripId) {
    try {
        const sheet = getSheet(SHEET_NAME_TRIPS);
        const rows = sheet.getDataRange().getValues();
        for (let i = rows.length - 1; i >= 1; i--) {
            if (rows[i][0] === tripId) {
                sheet.deleteRow(i + 1);
                break;
            }
        }
        // 関連するスケジュール・交通手段も削除
        _deleteSchedulesByTrip(tripId);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function _deleteSchedulesByTrip(tripId) {
    const schedSheet = getSheet(SHEET_NAME_SCHEDULE);
    const schedRows = schedSheet.getDataRange().getValues();
    const schedIds = [];
    for (let i = schedRows.length - 1; i >= 1; i--) {
        if (schedRows[i][1] === tripId) {
            schedIds.push(schedRows[i][0]);
            schedSheet.deleteRow(i + 1);
        }
    }
    // 関連する交通手段も削除
    const trnSheet = getSheet(SHEET_NAME_TRANSPORT);
    const trnRows = trnSheet.getDataRange().getValues();
    for (let i = trnRows.length - 1; i >= 1; i--) {
        if (trnRows[i][2] === tripId) {
            trnSheet.deleteRow(i + 1);
        }
    }
}

// ------------------------------------------------------------
// 旅程詳細取得（スケジュール + 交通手段）
// ------------------------------------------------------------

function getTripDetail(tripId) {
    try {
        const schedSheet = getSheet(SHEET_NAME_SCHEDULE);
        const trnSheet = getSheet(SHEET_NAME_TRANSPORT);

        const allSchedules = sheetToObjects(schedSheet);
        const allTransports = sheetToObjects(trnSheet);

        const schedules = allSchedules
            .filter(s => s['tripId'] === tripId)
            .sort((a, b) => {
                const dateA = a['日付'] + ' ' + a['開始時刻'];
                const dateB = b['日付'] + ' ' + b['開始時刻'];
                return dateA.localeCompare(dateB);
            });

        const transports = allTransports.filter(t => t['tripId'] === tripId);

        // スケジュールに交通手段をネスト
        const schedulesWithTransport = schedules.map(s => {
            const linked = transports.filter(t => t['scheduleId'] === s['scheduleId'] || t['transportId'] === s['transportId']);
            return { ...s, transports: linked };
        });

        // 日付でグループ化
        const byDate = {};
        schedulesWithTransport.forEach(s => {
            const d = s['日付'];
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(s);
        });

        return { success: true, data: { schedules: schedulesWithTransport, byDate, transports } };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ------------------------------------------------------------
// スケジュール CRUD
// ------------------------------------------------------------

function saveScheduleItem(data) {
    try {
        const sheet = getSheet(SHEET_NAME_SCHEDULE);
        const rows = sheet.getDataRange().getValues();

        if (data.scheduleId) {
            // 更新
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][0] === data.scheduleId) {
                    sheet.getRange(i + 1, 1, 1, 12).setValues([[
                        data.scheduleId, data.tripId || '', data.日付 || '',
                        data.開始時刻 || '', data.終了時刻 || '', data.カテゴリ || '',
                        data.タイトル || '', data.場所 || '', data.予約ステータス || '⬜ 未予約',
                        data.メモ || '', data.並び順 || 0, data.transportId || ''
                    ]]);
                    return { success: true, scheduleId: data.scheduleId };
                }
            }
        }
        // 新規作成
        const scheduleId = generateId('sch');
        sheet.appendRow([
            scheduleId, data.tripId || '', data.日付 || '',
            data.開始時刻 || '', data.終了時刻 || '', data.カテゴリ || '',
            data.タイトル || '', data.場所 || '', data.予約ステータス || '⬜ 未予約',
            data.メモ || '', data.並び順 || 0, data.transportId || ''
        ]);
        return { success: true, scheduleId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function deleteScheduleItem(scheduleId) {
    try {
        const sheet = getSheet(SHEET_NAME_SCHEDULE);
        const rows = sheet.getDataRange().getValues();
        for (let i = rows.length - 1; i >= 1; i--) {
            if (rows[i][0] === scheduleId) {
                sheet.deleteRow(i + 1);
                break;
            }
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ------------------------------------------------------------
// 交通手段 CRUD
// ------------------------------------------------------------

function saveTransport(data) {
    try {
        const sheet = getSheet(SHEET_NAME_TRANSPORT);
        const rows = sheet.getDataRange().getValues();

        // Google Maps URL を自動生成（出発地・到着地があれば）
        let mapsUrl = data.GoogleMapsURL || '';
        if (!mapsUrl && data.出発地 && data.到着地) {
            const origin = encodeURIComponent(data.出発地);
            const dest = encodeURIComponent(data.到着地);
            mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=transit`;
        }

        if (data.transportId) {
            // 更新
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][0] === data.transportId) {
                    sheet.getRange(i + 1, 1, 1, 13).setValues([[
                        data.transportId, data.scheduleId || '', data.tripId || '',
                        data.出発地 || '', data.到着地 || '', data.出発時刻 || '',
                        data.到着時刻 || '', data.路線名 || '', data.座席情報 || '',
                        data.料金 || '', data.優先度 || 'メイン', mapsUrl, data.メモ || ''
                    ]]);
                    return { success: true, transportId: data.transportId };
                }
            }
        }
        // 新規作成
        const transportId = generateId('trn');
        sheet.appendRow([
            transportId, data.scheduleId || '', data.tripId || '',
            data.出発地 || '', data.到着地 || '', data.出発時刻 || '',
            data.到着時刻 || '', data.路線名 || '', data.座席情報 || '',
            data.料金 || '', data.優先度 || 'メイン', mapsUrl, data.メモ || ''
        ]);
        return { success: true, transportId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function deleteTransport(transportId) {
    try {
        const sheet = getSheet(SHEET_NAME_TRANSPORT);
        const rows = sheet.getDataRange().getValues();
        for (let i = rows.length - 1; i >= 1; i--) {
            if (rows[i][0] === transportId) {
                sheet.deleteRow(i + 1);
                break;
            }
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ------------------------------------------------------------
// 初期セットアップ（スプレッドシートの初期化）
// ------------------------------------------------------------

function setupSpreadsheet() {
    try {
        getSheet(SHEET_NAME_TRIPS);
        getSheet(SHEET_NAME_SCHEDULE);
        getSheet(SHEET_NAME_TRANSPORT);
        return { success: true, message: 'スプレッドシートの初期化が完了しました' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}
