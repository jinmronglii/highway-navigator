import { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, AlertTriangle, Mic, Loader } from 'lucide-react';
import { parseHighwayLocation, LocationResult } from './services/gemini';
import { HWY_61_WAYPOINTS } from './services/waypoints';

type ErrorType = 'network' | 'parsing' | 'permission' | 'compatibility' | 'unknown';

interface AppError {
  type: ErrorType;
  message: string;
}

// 台61線中區真實交流道資料（來源：維基百科西部濱海快速公路交流道列表）
// type: 'interchange' = 立體交流道（有入口匝道可上主線）
// type: 'flat' = 平交匝道（只能進側車道，無法直接上主線）
interface UTurnPoint {
  km: number;
  name: string;
  type: 'interchange' | 'flat' | 'underpass';
}

// 台61線涵洞資料（來源：OpenStreetMap Overpass API，85k~130k 段）
const HWY_61_UNDERPASSES: UTurnPoint[] = [
  { km: 85.3, name: '崎頂隧道', type: 'underpass' },
  { km: 86.2, name: '涵洞 86.2k', type: 'underpass' },
  { km: 87.3, name: '龍昇街107巷涵洞', type: 'underpass' },
  { km: 87.9, name: '海濱森1號涵洞', type: 'underpass' },
  { km: 88.3, name: '海濱森2號涵洞', type: 'underpass' },
  { km: 88.5, name: '海濱森3號涵洞', type: 'underpass' },
  { km: 88.6, name: '海濱森4號涵洞', type: 'underpass' },
  { km: 88.8, name: '海濱森5號涵洞', type: 'underpass' },
  { km: 88.9, name: '海濱森6號涵洞', type: 'underpass' },
  { km: 89.1, name: '海濱森7號涵洞', type: 'underpass' },
  { km: 89.3, name: '海濱森8號涵洞', type: 'underpass' },
  { km: 90.4, name: '涵洞 90.4k', type: 'underpass' },
  { km: 94.8, name: '涵洞 94.8k', type: 'underpass' },
  { km: 117.8, name: '苗41線涵洞', type: 'underpass' },
  { km: 121.3, name: '涵洞 121.3k', type: 'underpass' },
  { km: 124.1, name: '介壽路涵洞', type: 'underpass' },
  { km: 126.3, name: '建國地下道', type: 'underpass' },
];

const HWY_61_UTURN_POINTS: UTurnPoint[] = [
  { km: 87.6, name: '崎頂平交匝道', type: 'flat' },
  { km: 89.2, name: '天祥平交匝道', type: 'flat' },
  { km: 89.2, name: '龍鳳平交匝道', type: 'flat' },
  { km: 90.4, name: '西濱系統交流道', type: 'interchange' },
  { km: 91.0, name: '博愛平交匝道', type: 'flat' },
  { km: 92.3, name: '復興平交匝道', type: 'flat' },
  { km: 93.6, name: '竹南平交匝道', type: 'flat' },
  { km: 99.6, name: '大山平交匝道', type: 'flat' },
  { km: 101.3, name: '外埔平交匝道', type: 'flat' },
  { km: 102.9, name: '溪洲交流道', type: 'interchange' },
  { km: 105.3, name: '後龍交流道', type: 'interchange' },
  { km: 109.3, name: '赤土崎交流道', type: 'interchange' },
  { km: 111.8, name: '白沙屯交流道', type: 'interchange' },
  { km: 115.0, name: '新埔交流道', type: 'interchange' },
  { km: 121.3, name: '通霄一交流道', type: 'interchange' },
  { km: 122.3, name: '通霄二交流道', type: 'interchange' },
  { km: 127.0, name: '苑裡交流道', type: 'interchange' },
  { km: 130.4, name: '房裡交流道', type: 'interchange' },
  { km: 134.0, name: '大甲交流道', type: 'interchange' },
  { km: 136.9, name: '福住交流道', type: 'interchange' },
  { km: 139.1, name: '大安一交流道', type: 'interchange' },
  { km: 144.0, name: '大安二交流道', type: 'interchange' },
  { km: 150.0, name: '清水交流道', type: 'interchange' },
  { km: 154.2, name: '梧棲交流道', type: 'interchange' },
  { km: 157.6, name: '龍井交流道', type: 'interchange' },
  { km: 166.2, name: '伸港交流道', type: 'interchange' },
  { km: 169.9, name: '線西交流道', type: 'interchange' },
  { km: 174.8, name: '洋厝交流道', type: 'interchange' },
  { km: 177.8, name: '鹿港交流道', type: 'interchange' },
  { km: 180.0, name: '福興交流道', type: 'interchange' },
  { km: 185.0, name: '漢寶交流道', type: 'interchange' },
  { km: 192.3, name: '王功交流道', type: 'interchange' },
  { km: 197.1, name: '芳苑交流道', type: 'interchange' },
  { km: 208.4, name: '大城交流道', type: 'interchange' },
];

// 找出最佳回轉點（總路程最短）
// 邏輯：總路程 = |目前位置 → 回轉點| + |回轉點 → 目的地|
// 回轉點必須在行進方向的前方（不能往回開）
function findBestUTurnPoint(
  currentKm: number,
  targetKm: number,
  destType: 'main' | 'side',
  direction: 'south' | 'north'
): UTurnPoint | null {
  // 合併所有回轉點
  const allPoints = [...HWY_61_UTURN_POINTS, ...HWY_61_UNDERPASSES];
  allPoints.sort((a, b) => a.km - b.km);

  // 篩選符合類型的回轉點
  const eligible = destType === 'main'
    ? allPoints.filter(p => p.type === 'interchange')
    : allPoints;

  if (eligible.length === 0) return null;

  // 只保留在行進方向前方的回轉點（不能往回開）
  const ahead = direction === 'south'
    ? eligible.filter(p => p.km > currentKm)   // 南下：前方是公里數更大
    : eligible.filter(p => p.km < currentKm);  // 北上：前方是公里數更小

  const candidates = ahead.length > 0 ? ahead : eligible;

  // 計算每個回轉點的總路程：到回轉點距離 + 回轉後到目的地距離
  // 回轉後在對向行駛，目的地公里數在對向上是相同的
  let best: UTurnPoint | null = null;
  let bestTotal = Infinity;

  for (const p of candidates) {
    const distToUturn = Math.abs(p.km - currentKm);    // 開到回轉點
    const distAfterUturn = Math.abs(p.km - targetKm);  // 回轉後開到目的地
    const total = distToUturn + distAfterUturn;
    if (total < bestTotal) {
      bestTotal = total;
      best = p;
    }
  }

  return best;
}

// 用 waypoints 插值出目標座標
function getTargetCoords(targetKm: number): { lat: number; lng: number } | null {
  const waypoints = HWY_61_WAYPOINTS;
  if (!waypoints || waypoints.length === 0) return null;

  if (targetKm <= waypoints[0].km) return { lat: waypoints[0].lat, lng: waypoints[0].lng };
  if (targetKm >= waypoints[waypoints.length - 1].km) {
    const last = waypoints[waypoints.length - 1];
    return { lat: last.lat, lng: last.lng };
  }

  for (let i = 0; i < waypoints.length - 1; i++) {
    const wp1 = waypoints[i];
    const wp2 = waypoints[i + 1];
    if (targetKm >= wp1.km && targetKm <= wp2.km) {
      const ratio = (targetKm - wp1.km) / (wp2.km - wp1.km);
      return {
        lat: wp1.lat + (wp2.lat - wp1.lat) * ratio,
        lng: wp1.lng + (wp2.lng - wp1.lng) * ratio,
      };
    }
  }
  return null;
}

export default function App() {
  const [isListening, setIsListening] = useState(false);
  // 分段式輸入狀態
  const [svHighway, setSvHighway] = useState<'61' | '72'>('61');
  const [svKm, setSvKm] = useState('');
  const [svDirection, setSvDirection] = useState<string>('南下');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<LocationResult | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [activeTab, setActiveTab] = useState<'street-view' | 'uturn'>('street-view');
  const [targetKm, setTargetKm] = useState('');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentKmOnHwy, setCurrentKmOnHwy] = useState<number | null>(null);
  const [destType, setDestType] = useState<'main' | 'side'>('main');
  const [direction, setDirection] = useState<'south' | 'north'>('south');
  const [uturnResult, setUturnResult] = useState<UTurnPoint | null>(null);
  const [manualCurrentKm, setManualCurrentKm] = useState(''); // 手動輸入目前公里數
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'zh-TW';

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        // 嘗試從語音結果解析公里數
        const kmMatch = transcript.match(/(\d+(?:\.\d+)?)/);
        if (kmMatch) setSvKm(kmMatch[1]);
        handleSearch(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setError({ type: 'permission', message: '麥克風權限被拒絕，請在瀏覽器設定中允許麥克風存取。' });
        } else if (event.error !== 'no-speech') {
          setError({ type: 'unknown', message: `語音辨識錯誤: ${event.error}` });
        }
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const startListening = () => {
    if (recognitionRef.current) {
      if (isListening) {
        recognitionRef.current.stop();
      } else {
        setError(null);
        recognitionRef.current.start();
      }
    }
  };

  // 組合分段式輸入並搜尋
  const handleSegmentedSearch = () => {
    if (!svKm) return;
    const dir = svHighway === '72' ? (svDirection || '東向') : (svDirection || '南下');
    const query = `台${svHighway}線${svKm}k${dir}`;
    handleSearch(query);
  };

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await parseHighwayLocation(query);
      if ('error' in res) {
        setError({ type: 'parsing', message: res.error });
        setResult(null);
      } else {
        setResult(res);
        setError(null);
      }
    } catch (err) {
      setError({ type: 'unknown', message: err instanceof Error ? err.message : '發生未知錯誤' });
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenStreetView = () => {
    if (!result) return;
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${result.lat},${result.lng}&heading=${result.heading}`;
    window.open(url, '_blank');
  };

  const handleOpenMap = () => {
    if (!result) return;
    const url = `https://www.google.com/maps/search/${result.lat},${result.lng}`;
    window.open(url, '_blank');
  };

  // 估算目前在台61線的公里數（用最近的 waypoint 反推）
  function estimateCurrentKm(lat: number, lng: number): number | null {
    const waypoints = HWY_61_WAYPOINTS;
    if (!waypoints || waypoints.length === 0) return null;
    let minDist = Infinity;
    let closestKm = null;
    for (const wp of waypoints) {
      const d = Math.sqrt(Math.pow(wp.lat - lat, 2) + Math.pow(wp.lng - lng, 2));
      if (d < minDist) {
        minDist = d;
        closestKm = wp.km;
      }
    }
    return closestKm;
  }

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setCurrentLocation(loc);
          const km = estimateCurrentKm(loc.lat, loc.lng);
          setCurrentKmOnHwy(km);
          setError(null);
          setUturnResult(null);
        },
        () => {
          setError({ type: 'permission', message: '無法獲取位置，請檢查位置權限' });
        }
      );
    } else {
      setError({ type: 'compatibility', message: '您的瀏覽器不支援地理定位' });
    }
  };

  const handleCalculateUTurn = () => {
    if (!targetKm) {
      setError({ type: 'parsing', message: '請輸入目標公里數' });
      return;
    }

    const km = parseFloat(targetKm);
    if (isNaN(km)) {
      setError({ type: 'parsing', message: '請輸入有效的目標公里數' });
      return;
    }

    // 優先用手動輸入的公里數，其次用 GPS 估算
    let myKm: number | null = null;
    if (manualCurrentKm && !isNaN(parseFloat(manualCurrentKm))) {
      myKm = parseFloat(manualCurrentKm);
    } else if (currentKmOnHwy) {
      myKm = currentKmOnHwy;
    }

    if (!myKm) {
      setError({ type: 'parsing', message: '請輸入目前公里數，或點擊「獲取我的位置」' });
      return;
    }

    // 找最佳回轉點（總路程最短）
    console.log('[DEBUG] myKm=', myKm, 'targetKm=', km, 'destType=', destType, 'direction=', direction);
    const best = findBestUTurnPoint(myKm, km, destType, direction);
    console.log('[DEBUG] best=', best);
    if (!best) {
      setError({ type: 'parsing', message: '找不到合適的回轉點' });
      return;
    }

    setUturnResult(best);
    setError(null);

    // 導航到回轉點（用 GPS 座標導航，沒有 GPS 就用公里數插値座標）
    const startCoords = currentLocation || getTargetCoords(myKm);
    const uturnCoords = getTargetCoords(best.km);
    if (startCoords && uturnCoords) {
      const url = `https://www.google.com/maps/dir/${startCoords.lat},${startCoords.lng}/${uturnCoords.lat},${uturnCoords.lng}`;
      window.open(url, '_blank');
    } else if (uturnCoords) {
      // 至少導航到回轉點
      const url = `https://www.google.com/maps/search/${uturnCoords.lat},${uturnCoords.lng}`;
      window.open(url, '_blank');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg">
            <Navigation size={32} />
          </div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            {activeTab === 'street-view' ? '台61、台72線街景定位系統' : '台61線回轉導航系統'}
            <span className="ml-3 text-2xl text-blue-500">龍龍龍</span>
          </h1>
          <p className="text-slate-600">
            GPS 定位 • 街景查詢 • 實時導航
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 bg-white rounded-lg shadow-sm p-1 w-fit mx-auto">
          <button
            onClick={() => setActiveTab('street-view')}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${
              activeTab === 'street-view'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            街景定位
          </button>
          <button
            onClick={() => setActiveTab('uturn')}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${
              activeTab === 'uturn'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            回轉導航
          </button>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          {activeTab === 'street-view' && (
            <div className="space-y-6">
              {/* Input Section - 分段式 */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-100 p-6 rounded-xl border border-blue-200">
                <label className="block text-sm font-bold text-slate-900 mb-4">
                  🎥 台61、台72線街景定位系統
                </label>

                {/* 分段式輸入列 */}
                <div className="flex items-center gap-1 mb-4 flex-wrap">
                  {/* 台 - 固定 */}
                  <span className="text-xl font-bold text-slate-800 px-2">台</span>

                  {/* 61 / 72 選擇 */}
                  <div className="flex rounded-lg overflow-hidden border-2 border-blue-400">
                    {(['61', '72'] as const).map((hw, idx) => (
                      <>
                        {idx === 1 && <div className="w-px bg-blue-400" />}
                        <button
                          key={hw}
                          onClick={() => {
                            setSvHighway(hw);
                            setSvDirection(hw === '72' ? '東向' : '南下');
                          }}
                          className={`px-4 py-3 font-bold text-lg transition-all ${
                            svHighway === hw
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-slate-700 hover:bg-blue-50'
                          }`}
                        >
                          {hw}
                        </button>
                      </>
                    ))}
                  </div>

                  {/* 線 - 固定 */}
                  <span className="text-xl font-bold text-slate-800 px-1">線</span>

                  {/* 公里數輸入 */}
                  <input
                    type="number"
                    value={svKm}
                    onChange={(e) => setSvKm(e.target.value)}
                    placeholder="105"
                    className="w-24 px-3 py-3 text-xl font-bold text-center border-2 border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyPress={(e) => e.key === 'Enter' && handleSegmentedSearch()}
                  />

                  {/* k - 固定 */}
                  <span className="text-xl font-bold text-slate-800 px-1">k</span>

                  {/* 方向選擇 */}
                  <div className="flex rounded-lg overflow-hidden border-2 border-blue-400">
                    {(svHighway === '61'
                      ? ['南下', '北上']
                      : ['東向', '西向']
                    ).map(dir => (
                      <button
                        key={dir}
                        onClick={() => setSvDirection(dir)}
                        className={`px-3 py-3 font-bold text-base transition-all ${
                          svDirection === dir
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-blue-50'
                        }`}
                      >
                        {dir}
                      </button>
                    ))}
                  </div>

                  {/* 語音按鈕 */}
                  <button
                    onClick={startListening}
                    disabled={isLoading}
                    className={`px-4 py-3 rounded-lg font-bold transition-all flex items-center justify-center ${
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                    title="語音輸入"
                  >
                    <Mic size={20} />
                  </button>
                </div>

                {/* 預覽組合 */}
                {svKm && (
                  <p className="text-sm text-blue-700 mb-3 font-mono bg-blue-100 px-3 py-2 rounded">
                    查詢：台{svHighway}線 {svKm}k {svDirection}
                  </p>
                )}

                <button
                  onClick={handleSegmentedSearch}
                  disabled={isLoading || !svKm}
                  className={`w-full py-4 font-bold text-lg rounded-lg transition-all flex items-center justify-center gap-2 ${
                    isLoading || !svKm
                      ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <Loader size={20} className="animate-spin" />
                      定位中...
                    </>
                  ) : (
                    <>
                      <MapPin size={20} />
                      查看街景
                    </>
                  )}
                </button>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border-l-4 border-red-600 p-4 rounded flex gap-3">
                  <AlertTriangle className="text-red-600 flex-shrink-0" size={20} />
                  <div>
                    <h3 className="font-bold text-red-900">錯誤</h3>
                    <p className="text-red-800">{error.message}</p>
                  </div>
                </div>
              )}

              {/* Street View Info */}
              {result && (
                <div className="space-y-4">
                  <div className="bg-green-50 border-l-4 border-green-600 p-4 rounded">
                    <h3 className="font-bold text-green-900 mb-3">✅ 位置已定位</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white p-3 rounded border border-green-200">
                        <p className="text-xs text-slate-600">公路</p>
                        <p className="text-xl font-bold text-green-600">台{result.highway}線</p>
                      </div>
                      <div className="bg-white p-3 rounded border border-green-200">
                        <p className="text-xs text-slate-600">公里數</p>
                        <p className="text-xl font-bold text-green-600">{result.km.toFixed(1)}k</p>
                      </div>
                      <div className="bg-white p-3 rounded border border-green-200">
                        <p className="text-xs text-slate-600">方向</p>
                        <p className="text-xl font-bold text-green-600">{result.direction || '未指定'}</p>
                      </div>
                      <div className="bg-white p-3 rounded border border-green-200">
                        <p className="text-xs text-slate-600">鏡頭角度</p>
                        <p className="text-xl font-bold text-green-600">{result.heading}°</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 border-l-4 border-slate-600 p-4 rounded">
                    <h3 className="font-bold text-slate-900 mb-2">🗺️ GPS 座標</h3>
                    <p className="text-sm text-slate-700 font-mono">
                      {result.lat.toFixed(6)}, {result.lng.toFixed(6)}
                    </p>
                    {result.placeName && (
                      <p className="text-sm text-slate-600 mt-2">📍 {result.placeName}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={handleOpenStreetView}
                      className="py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                      🎥 街景
                    </button>
                    <button
                      onClick={handleOpenMap}
                      className="py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                      🗺️ 地圖
                    </button>
                  </div>
                </div>
              )}

              {!result && !isLoading && (
                <div className="text-center py-8 text-slate-500">
                  <MapPin size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="text-lg">輸入位置資訊開始定位</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'uturn' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl border border-purple-200">
                <label className="block text-sm font-bold text-slate-900 mb-3">
                  🔄 台61線回轉導航系統
                </label>

                {/* 行進方向選擇 */}
                <div className="mb-4">
                  <p className="text-sm font-semibold text-slate-700 mb-2">目前行進方向：</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setDirection('south')}
                      className={`flex-1 py-3 px-4 rounded-lg font-bold border-2 transition-all ${
                        direction === 'south'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400'
                      }`}
                    >
                      ⬇️ 南下
                      <p className="text-xs font-normal mt-1 opacity-80">公里數遞增</p>
                    </button>
                    <button
                      onClick={() => setDirection('north')}
                      className={`flex-1 py-3 px-4 rounded-lg font-bold border-2 transition-all ${
                        direction === 'north'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400'
                      }`}
                    >
                      ⬆️ 北上
                      <p className="text-xs font-normal mt-1 opacity-80">公里數遞減</p>
                    </button>
                  </div>
                </div>

                {/* 目的地類型選擇 */}
                <div className="mb-4">
                  <p className="text-sm font-semibold text-slate-700 mb-2">目的地在對向的：</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setDestType('main')}
                      className={`flex-1 py-3 px-4 rounded-lg font-bold border-2 transition-all ${
                        destType === 'main'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-purple-400'
                      }`}
                    >
                      🛣️ 主線
                      <p className="text-xs font-normal mt-1 opacity-80">需找立體交流道</p>
                    </button>
                    <button
                      onClick={() => setDestType('side')}
                      className={`flex-1 py-3 px-4 rounded-lg font-bold border-2 transition-all ${
                        destType === 'side'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-purple-400'
                      }`}
                    >
                      🛤️ 側車道
                      <p className="text-xs font-normal mt-1 opacity-80">平交匝道即可</p>
                    </button>
                  </div>
                  {destType === 'main' && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                      ⚠️ 主線目的地：涵洞回轉後無法直接上主線，需找前方有入口匝道的立體交流道
                    </p>
                  )}
                  {destType === 'side' && (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2 mt-2">
                      ✅ 側車道目的地：平交匝道即可回轉，找最近的匝道
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  {/* 目前公里數（手動輸入） */}
                  <div>
                    <p className="text-xs text-slate-600 mb-1">目前所在公里數（手動輸入，優先於 GPS）</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-700">台61線</span>
                      <input
                        type="number"
                        value={manualCurrentKm}
                        onChange={(e) => { setManualCurrentKm(e.target.value); setUturnResult(null); }}
                        placeholder="例如：100"
                        className="flex-1 px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                      <span className="text-sm font-bold text-slate-700">k</span>
                    </div>
                    {currentKmOnHwy && !manualCurrentKm && (
                      <p className="text-xs text-purple-600 mt-1">ℹ️ GPS 估算：台61線 約 {currentKmOnHwy.toFixed(1)}k（仅供參考）</p>
                    )}
                  </div>

                  {/* 目標公里數 */}
                  <div>
                    <p className="text-xs text-slate-600 mb-1">目的地公里數（對向）</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-700">台61線</span>
                      <input
                        type="number"
                        value={targetKm}
                        onChange={(e) => { setTargetKm(e.target.value); setUturnResult(null); }}
                        placeholder="例如：95"
                        className="flex-1 px-4 py-3 border-2 border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                      <span className="text-sm font-bold text-slate-700">k</span>
                    </div>
                  </div>

                  <button
                    onClick={handleGetLocation}
                    className="w-full py-3 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                  >
                    <MapPin size={18} />
                    {currentLocation ? '✓ 已取得 GPS（點擊重新定位）' : 'GPS 定位（可選）'}
                  </button>

                  <button
                    onClick={handleCalculateUTurn}
                    disabled={!targetKm || (!manualCurrentKm && !currentKmOnHwy)}
                    className={`w-full py-4 font-bold text-lg rounded-lg transition-all flex items-center justify-center gap-2 ${
                      !targetKm || (!manualCurrentKm && !currentKmOnHwy)
                        ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                        : 'bg-purple-700 hover:bg-purple-800 text-white shadow-lg hover:shadow-xl'
                    }`}
                  >
                    <Navigation size={20} />
                    計算回轉點並導航
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border-l-4 border-red-600 p-4 rounded flex gap-3">
                  <AlertTriangle className="text-red-600 flex-shrink-0" size={20} />
                  <div>
                    <h3 className="font-bold text-red-900">錯誤</h3>
                    <p className="text-red-800">{error.message}</p>
                  </div>
                </div>
              )}

              {currentLocation && (
                <div className="bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                  <h3 className="font-bold text-purple-900 mb-2">📍 目前位置</h3>
                  <p className="text-sm text-purple-700 font-mono">
                    {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
                  </p>
                  {currentKmOnHwy && (
                    <p className="text-sm text-purple-700 mt-1">
                      估算位置：台61線 約 <strong>{currentKmOnHwy.toFixed(1)}k</strong>
                    </p>
                  )}
                </div>
              )}

              {uturnResult && (
                <div className="bg-yellow-50 border-l-4 border-yellow-500 p-3 rounded text-xs text-yellow-800 mb-2 font-mono">
                  [除錯] 目前公里數: {manualCurrentKm || currentKmOnHwy?.toFixed(1) || '?'}k | 目的地: {targetKm}k | 方向: {direction === 'south' ? '南下' : '北上'} | 類型: {destType === 'main' ? '主線' : '側車道'}
                </div>
              )}
              {uturnResult && (
                <div className="bg-green-50 border-l-4 border-green-600 p-4 rounded">
                  <h3 className="font-bold text-green-900 mb-2">
                    ✅ 建議回轉點
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-3 rounded border border-green-200">
                      <p className="text-xs text-slate-600">回轉點名稱</p>
                      <p className="text-lg font-bold text-green-700">{uturnResult.name}</p>
                    </div>
                    <div className="bg-white p-3 rounded border border-green-200">
                      <p className="text-xs text-slate-600">公里數</p>
                      <p className="text-lg font-bold text-green-700">{uturnResult.km}k</p>
                    </div>
                    <div className="bg-white p-3 rounded border border-green-200 col-span-2">
                      <p className="text-xs text-slate-600">類型</p>
                      <p className="text-sm font-bold text-green-700">
                        {uturnResult.type === 'interchange' ? '🛣️ 立體交流道（可上主線）' : uturnResult.type === 'underpass' ? '🕳️ 涵洞（側車道回轉）' : '🛤️ 平交匝道（側車道）'}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">已在 Google Maps 中開啟導航</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
