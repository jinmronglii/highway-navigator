import { GoogleGenAI, Type } from "@google/genai";
import { HWY_72_WAYPOINTS, HWY_61_WAYPOINTS } from "./waypoints";

let ai: any = null;
function getAI() {
  if (!ai) {
    const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

export interface LocationResult {
  highway: string;
  km: number;
  direction: string;
  lat: number;
  lng: number;
  heading: number;
  placeName?: string;
}

function interpolateLocation(highway: string, targetKm: number): { lat: number, lng: number } {
  const waypoints = highway === "72" ? HWY_72_WAYPOINTS : HWY_61_WAYPOINTS;
  
  if (targetKm <= waypoints[0].km) return { lat: waypoints[0].lat, lng: waypoints[0].lng };
  if (targetKm >= waypoints[waypoints.length - 1].km) return { lat: waypoints[waypoints.length - 1].lat, lng: waypoints[waypoints.length - 1].lng };

  for (let i = 0; i < waypoints.length - 1; i++) {
    const wp1 = waypoints[i];
    const wp2 = waypoints[i + 1];
    if (targetKm >= wp1.km && targetKm <= wp2.km) {
      const ratio = (targetKm - wp1.km) / (wp2.km - wp1.km);
      const lat = wp1.lat + (wp2.lat - wp1.lat) * ratio;
      const lng = wp1.lng + (wp2.lng - wp1.lng) * ratio;
      return { lat, lng };
    }
  }
  return { lat: waypoints[0].lat, lng: waypoints[0].lng };
}

export async function parseHighwayLocation(input: string): Promise<LocationResult | { error: string }> {
  console.log("User input:", input);
  
  let highway = "";
  let km = 0;
  let direction = "";
  let heading = 0;
  let approxLat = 0;
  let approxLng = 0;

  const highwayMatch = input.match(/(?:台|臺)?(72|61)(?:線)?/i);
  let parsedFromRegex = false;

  if (highwayMatch) {
    const cleanedInput = input.replace(highwayMatch[0], '');
    const kmMatch = cleanedInput.match(/(\d+(?:\.\d+)?)\s*(?:k|K|公里)?/i);
    
    if (kmMatch) {
      highway = highwayMatch[1];
      km = parseFloat(kmMatch[1]);
      parsedFromRegex = true;
    }
  }
  
  if (parsedFromRegex) {
    console.log(`Regex matched: Highway ${highway}, KM ${km}`);
    
    const cleanedForDir = input.replace(/(?:東西向(?:快速公路|快速道路)?|西濱(?:快速公路|快速道路)?)/g, '');
    const dirMatch = cleanedForDir.match(/(南下|北上|東向|西向|往東|往西|往南|往北|向東|向西|向南|向北|[東南西北])/);
    if (dirMatch) {
      direction = dirMatch[1];
      if (direction.includes("東")) heading = 90;
      else if (direction.includes("西")) heading = 270;
      else if (direction.includes("南") || direction.includes("下")) heading = 180;
      else if (direction.includes("北") || direction.includes("上")) heading = 0;
    } else {
      heading = highway === "72" ? 90 : 180;
    }

    const loc = interpolateLocation(highway, km);
    approxLat = loc.lat;
    approxLng = loc.lng;
  } else {
    try {
      const gRequest = getAI().models.generateContent({
        model: "gemini-2.5-flash",
        contents: `你是一個台灣公路座標專家。使用者輸入了一段文字，請從中擷取公路編號（台72或台61）、公里數（k），以及單一方向（例如 '東向', '西向', '南下', '北上'）。
        注意：使用者可能會輸入中文數字（如十五）或大小寫K，請一律轉換為阿拉伯數字的公里數。
        若使用者輸入的文字包含「東西向」或「西濱」，這只是公路的別稱，請予以忽略。若未明確指定單向行駛方向，請將 direction 留空，**絕對不要**因此回傳 error。
        若使用者明確給定「東向」或「往東」，方向就填「東向」；若為「西向」則填「西向」；若為「往南」或「南下」則填「南下」。
        
        如果使用者輸入的內容完全與台72線或台61線無關，或者"缺少公里數"，這時才請在 error 欄位填寫屬實的錯誤原因。
        
        使用者輸入："${input}"`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              highway: { type: Type.STRING, description: "公路編號，僅填寫 '72' 或 '61'" },
              km: { type: Type.NUMBER, description: "公里數，例如 15" },
              direction: { type: Type.STRING, description: "方向，例如 '往東', '往西', '往南', '往北'，若無則留空" },
              heading: { type: Type.NUMBER, description: "攝影機朝向角度 (0-360)" },
              error: { type: Type.STRING, description: "如果無法辨識，請填寫錯誤原因" }
            }
          }
        }
      });
      
      let timeoutId: any;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('AI 解析逾時，請檢查連線或稍微改變說法再試一次')), 8000);
      });

      const response: any = await Promise.race([gRequest, timeoutPromise]);
      clearTimeout(timeoutId);
      
      let text = response.text;
      if (!text) return { error: "AI 回傳空值" };
      
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const data = JSON.parse(text);
      
      if (data.error) return { error: data.error };
      if (!data.highway || data.km === undefined) return { error: "無法從輸入中辨識出有效的公路編號或公里數" };

      highway = data.highway.replace(/台|線/g, '');
      if (highway !== "72" && highway !== "61") return { error: `不支援的公路編號: ${data.highway}` };
      
      km = data.km;
      direction = data.direction || "";
      
      if (direction === "東" || direction.includes("東")) heading = 90;
      else if (direction === "西" || direction.includes("西")) heading = 270;
      else if (direction === "南" || direction.includes("南")) heading = 180;
      else if (direction === "北" || direction.includes("北")) heading = 0;
      else if (data.heading !== undefined) heading = data.heading;
      // 台61線預設南下(180)，台72線預設東向(90)
      else heading = highway === "72" ? 90 : 180;
      
      const loc = interpolateLocation(highway, km);
      approxLat = loc.lat;
      approxLng = loc.lng;
    } catch (error: any) {
      console.error("Error parsing location:", error);
      return { error: `系統錯誤: ${error.message || "發生未知錯誤"}` };
    }
  }

  let placeName = "";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${approxLat}&lon=${approxLng}&format=json&accept-language=zh-TW`, {
      headers: {
        'User-Agent': 'TaiwanHighwayLocator/1.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    if (res.ok) {
      const geoData = await res.json();
      if (geoData && geoData.address) {
         const addr = geoData.address;
         const parts = [];
         if (addr.county) parts.push(addr.county);
         if (addr.town || addr.city_district) parts.push(addr.town || addr.city_district);
         if (addr.village || addr.hamlet) parts.push(addr.village || addr.hamlet);
         placeName = parts.length > 0 ? parts.join('') : (geoData.display_name || "").split(',')[0];
      }
    }
  } catch(e) {
    console.error("Reverse geocode failed", e);
  }

  return { highway, km, direction, lat: approxLat, lng: approxLng, heading, placeName };
}
