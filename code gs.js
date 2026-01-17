/**
 * TipTap Pro API v9.0
 * Backend Stable Version for Vercel
 */

var VERCEL_URL = "https://tip-tap-azure.vercel.app";

function doGet(e) {
  try {
    var id = (e.parameter.id || "").toString();
    var action = e.parameter.action;
    if (!id) return returnJSON({ error: "Missing ID" });

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = sheet.getDataRange().getValues();
    var row = null;
    var rowIndex = -1;

    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() == id) {
        row = data[i];
        rowIndex = i + 1;
        break;
      }
    }

    // בדיקת חסימת PIN (עמודה K - 11)
    var now = new Date();
    if (row && row[10] && row[10] instanceof Date && now < row[10]) {
       return returnJSON({ status: "LOCKED", minutes: Math.ceil((row[10]-now)/60000) });
    }

    if (action === "getData" || !action) {
      if (!row || !row[1] || row[1] === "") return returnJSON({ status: "NEW", id: id });
      sheet.getRange(rowIndex, 7).setValue((parseInt(row[6]) || 0) + 1); // מונה סריקות
      return returnJSON({
        status: "ACTIVE", type: row[1], bit: row[2] || "", link: row[4] || "", name: row[7] || "בעל הכרטיס"
      });
    }

    if (action === "save") {
      var vals = [e.parameter.type, e.parameter.bit || "", "", e.parameter.direct || "", new Date(), 0, e.parameter.name, e.parameter.pin, 0, ""];
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 2, 1, 9).setValues([vals.slice(0, 9)]);
      } else {
        sheet.appendRow([id].concat(vals));
      }
      return redirect(id);
    }

    if (action === "reset") {
      if (row && row[8].toString() == e.parameter.pin.toString()) {
        sheet.getRange(rowIndex, 2, 1, 4).setValues([["","","",""]]);
        return redirect(id, "&reset=true");
      }
      return returnJSON({ success: false, error: "Incorrect PIN" });
    }
    
    if (action === "getStats") {
      if (row && row[8].toString() == e.parameter.pin.toString()) {
        var days = Math.ceil(Math.abs(new Date() - new Date(row[5])) / 86400000) || 1;
        var workDays = (days / 7) * 5;
        return returnJSON({ success: true, total: row[6] || 0, average: (row[6] / (workDays < 1 ? 1 : workDays)).toFixed(1) });
      }
      return returnJSON({ success: false });
    }
  } catch (err) { return returnJSON({ error: err.toString() }); }
}

function redirect(id, extra) {
  var url = VERCEL_URL + "?id=" + id + (extra || "");
  return HtmlService.createHtmlOutput("<script>window.top.location.href='" + url + "';</script>");
}

function returnJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}