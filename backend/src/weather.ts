import { config } from './config';

/**
 * 真实天气服务（定位解析 + 天气查询）
 *
 * 数据源策略（两套，自动择一）：
 * 1) 高德地图（推荐，国内稳定、地名/区县精准）：需在 .env 配置 AMAP_KEY
 *    - 逆地理编码：经纬度 → 省/市/区县 + adcode
 *    - 天气：adcode → 实况 + 未来多天预报
 * 2) 免 Key 兜底方案（无需任何配置即可跑通）：
 *    - 逆地理编码：OpenStreetMap Nominatim（经纬度 → 省/市/区，支持中文）
 *    - 城市名 → 坐标：Open-Meteo Geocoding
 *    - 天气：Open-Meteo（实况 + 多天预报 + 空气质量）
 *
 * 对上层只暴露 getWeatherReport()，内部屏蔽数据源差异。
 */

/** 经纬度坐标 */
export interface GeoLocation {
  latitude: number;
  longitude: number;
}

/** 定位 / 地理编码得到的行政区信息 */
export interface PlaceInfo {
  country?: string;
  province?: string;
  city: string;
  district?: string;
  /** 用于展示的简称，如「长沙岳麓区」 */
  displayName: string;
  /** 高德行政区划编码（区县级），仅高德数据源有 */
  adcode?: string;
}

/** 单日预报 */
export interface ForecastDay {
  date: string; // 10月11日
  weekday: string; // 周日
  textDay: string; // 白天天气
  textNight?: string; // 夜间天气
  tempMax: number;
  tempMin: number;
  windDir?: string;
  windScale?: string;
}

/** 天气报告（工具最终返回给模型的结构） */
export interface WeatherReport {
  place: PlaceInfo;
  current: {
    text: string;
    temperature: number;
    feelsLike?: number;
    humidity?: number;
    windDir?: string;
    windScale?: string;
    aqi?: number;
    aqiCategory?: string;
    reportTime: string;
  };
  forecast: ForecastDay[];
  tips: string[];
  source: string;
}

const FETCH_TIMEOUT_MS = 8000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 带去超时的 JSON 请求（后端唯一的外部 HTTP 出口） */
async function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'mahatma-assistant/1.0 (weather tool)' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 去掉行政区后缀，用于拼接简称（长沙市 → 长沙） */
function stripSuffix(name?: string): string {
  if (!name) return '';
  return name.replace(/(省|市|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|地区|盟)$/, '');
}

/** 拼接展示简称：市简称 + 区县（长沙市 + 岳麓区 → 长沙岳麓区） */
function joinDisplayName(city: string, district?: string): string {
  const shortCity = stripSuffix(city);
  // 区县与市同名（或市级缺省回退到区名）时避免重复拼接
  if (!district || district === city || district === shortCity) {
    return shortCity || city;
  }
  return `${shortCity}${district}`;
}

/** 当前日期/星期（按东八区，避免服务器时区差异） */
function nowInBeijing(): { date: string; weekday: string; index: number } {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return {
    date: `${m}月${d}日`,
    weekday: WEEKDAYS[now.getUTCDay()],
    index: now.getUTCDay(),
  };
}

/** 把报告时间统一成 HH:MM（兼容 "2026-10-10T18:15" 与 "2026-10-10 18:00:00"） */
function formatTime(raw?: string): string {
  if (!raw) return '';
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : raw;
}

/** 把 YYYY-MM-DD 转成「10月11日 / 周日」 */
function formatDay(iso: string): { date: string; weekday: string } {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3) return { date: iso, weekday: '' };
  const [y, m, d] = parts;
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { date: `${m}月${d}日`, weekday: WEEKDAYS[day] };
}

/** 根据实况与温度生成简单穿衣 / 出行建议 */
function buildTips(current: { temperature: number; text: string }, today: ForecastDay): string[] {
  const tips: string[] = [];
  const t = Number.isFinite(current.temperature) ? current.temperature : today.tempMax;

  if (t <= 0) tips.push('天气严寒，建议穿羽绒服并做好防风保暖');
  else if (t <= 10) tips.push('气温较低，建议穿棉衣 / 羽绒服');
  else if (t <= 18) tips.push('体感偏凉，建议穿外套 / 风衣');
  else if (t <= 26) tips.push('体感舒适，长袖或薄外套即可');
  else if (t <= 32) tips.push('天气偏热，建议穿短袖等轻薄衣物');
  else tips.push('天气炎热，注意防暑降温、及时补水');

  const range = today.tempMax - today.tempMin;
  if (Number.isFinite(range) && range >= 8) {
    tips.push(`昼夜温差约 ${Math.round(range)}℃，早晚记得添衣`);
  }

  const text = `${today.textDay}${today.textNight ?? ''}${current.text}`;
  if (/雨/.test(text)) tips.push('有降雨，出门记得带伞');
  if (/雪/.test(text)) tips.push('有降雪，注意路面湿滑');
  if (/雾|霾/.test(text)) tips.push('有雾 / 霾，出行注意交通安全');
  return tips;
}

// ==================== 高德地图数据源（需 AMAP_KEY） ====================

/** 高德逆地理编码：经纬度 → 行政区 + adcode */
async function reverseGeocodeAmap(loc: GeoLocation): Promise<PlaceInfo | null> {
  const url =
    `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(config.amapKey)}` +
    `&location=${loc.longitude},${loc.latitude}&extensions=base`;
  const data = await fetchJson(url);
  if (data?.status !== '1' || !data?.regeocode) return null;

  const ac = data.regeocode.addressComponent ?? {};
  const province: string | undefined = typeof ac.province === 'string' ? ac.province : undefined;
  // 直辖市（北京/上海/天津/重庆）的 city 字段为空数组，回退用 province
  const rawCity = typeof ac.city === 'string' && ac.city ? ac.city : province ?? '';
  const district: string | undefined = typeof ac.district === 'string' ? ac.district : undefined;
  const city = rawCity || district || province || '当前位置';

  return {
    country: typeof ac.country === 'string' ? ac.country : undefined,
    province,
    city,
    district,
    displayName: joinDisplayName(city, district),
    adcode: typeof ac.adcode === 'string' ? ac.adcode : undefined,
  };
}

/** 高德地理编码：城市名 → adcode（用于用户明确指定城市） */
async function geocodeAmap(city: string): Promise<PlaceInfo | null> {
  const url =
    `https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(config.amapKey)}` +
    `&address=${encodeURIComponent(city)}`;
  const data = await fetchJson(url);
  if (data?.status !== '1' || !Array.isArray(data?.geocodes) || data.geocodes.length === 0) return null;

  const g = data.geocodes[0];
  const province: string | undefined = typeof g.province === 'string' ? g.province : undefined;
  const rawCity = typeof g.city === 'string' && g.city ? g.city : province ?? city;
  const district: string | undefined = typeof g.district === 'string' && g.district ? g.district : undefined;

  return {
    province,
    city: rawCity,
    district,
    displayName: joinDisplayName(rawCity, district),
    adcode: typeof g.adcode === 'string' ? g.adcode : undefined,
  };
}

/** 高德天气：实况 + 未来多天预报（city 传 adcode 可精确到区县） */
async function fetchWeatherAmap(place: PlaceInfo): Promise<WeatherReport> {
  const cityParam = place.adcode || place.city;
  const url =
    `https://restapi.amap.com/v3/weather/weatherInfo?key=${encodeURIComponent(config.amapKey)}` +
    `&city=${encodeURIComponent(cityParam)}&extensions=all`;
  const data = await fetchJson(url);
  if (data?.status !== '1' || !Array.isArray(data?.lives) || data.lives.length === 0) {
    throw new Error('高德天气接口返回异常');
  }

  const live = data.lives[0];
  const forecast = Array.isArray(data.forecasts) ? data.forecasts[0] : undefined;
  const casts: any[] = forecast?.casts ?? [];

  const days: ForecastDay[] = casts.map((c) => ({
    date: c.date,
    weekday: c.week ?? '',
    textDay: c.dayweather ?? '',
    textNight: c.nightweather ?? '',
    tempMax: Number(c.daytemp),
    tempMin: Number(c.nighttemp),
    windDir: c.daywind,
    windScale: c.daypower ? `${c.daypower}级` : undefined,
  }));

  const first = days[0];
  const today: ForecastDay = first ?? {
    date: nowInBeijing().date,
    weekday: nowInBeijing().weekday,
    textDay: live.weather ?? '',
    tempMax: Number(live.temperature),
    tempMin: Number(live.temperature),
  };

  const current = {
    text: live.weather ?? '',
    temperature: Number(live.temperature),
    humidity: live.humidity !== undefined ? Number(live.humidity) : undefined,
    windDir: live.winddirection ? `${live.winddirection}风` : undefined,
    windScale: live.windpower ? `${live.windpower}级` : undefined,
    reportTime: formatTime(live.reporttime),
  };

  return {
    place,
    current,
    forecast: days,
    tips: buildTips(current, today),
    source: '高德地图',
  };
}

// ==================== 免 Key 兜底数据源 ====================

/** 逆地理结果缓存（Nominatim 有 1 req/s 频率限制，简单缓存降低请求量） */
const geoCache = new Map<string, { place: PlaceInfo; at: number }>();
const GEO_CACHE_TTL = 60 * 60 * 1000;

/** 经纬度 → 城市/区（OpenStreetMap Nominatim，免费无 Key，支持中文地名） */
async function reverseGeocodeFree(loc: GeoLocation): Promise<PlaceInfo | null> {
  const cacheKey = `${loc.latitude.toFixed(3)},${loc.longitude.toFixed(3)}`;
  const cached = geoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GEO_CACHE_TTL) return cached.place;

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${loc.latitude}&lon=${loc.longitude}&accept-language=zh-CN&zoom=16`;
  const data = await fetchJson(url);
  const addr = data?.address;
  if (!addr) return null;

  // 注意 Nominatim 的字段语义：region=地级市，state=省，district/city=区县
  const province: string | undefined = addr.state;
  const city: string = addr.region || addr.city || addr.county || addr.state || '当前位置';
  const rawDistrict: string | undefined = addr.district || addr.city_district || addr.city;
  const district = rawDistrict && rawDistrict !== city ? rawDistrict : undefined;

  const place: PlaceInfo = {
    country: addr.country,
    province,
    city,
    district,
    displayName: joinDisplayName(city, district),
  };
  geoCache.set(cacheKey, { place, at: Date.now() });
  return place;
}

/** 城市名 → 经纬度（Open-Meteo Geocoding，免费无 Key，支持中文） */
async function geocodeFree(city: string): Promise<{ place: PlaceInfo; location: GeoLocation } | null> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}` +
    `&count=1&language=zh&format=json`;
  const data = await fetchJson(url);
  const hit = Array.isArray(data?.results) ? data.results[0] : null;
  if (!hit) return null;

  const place: PlaceInfo = {
    country: hit.country,
    province: hit.admin1,
    city: hit.name ?? city,
    displayName: joinDisplayName(hit.name ?? city, undefined),
  };
  return { place, location: { latitude: Number(hit.latitude), longitude: Number(hit.longitude) } };
}

/** WMO 天气代码 → 中文描述 */
function wmoText(code: number): string {
  const map: Record<number, string> = {
    0: '晴',
    1: '晴间多云',
    2: '多云',
    3: '阴',
    45: '雾',
    48: '雾凇',
    51: '小毛毛雨',
    53: '毛毛雨',
    55: '大毛毛雨',
    56: '冻毛毛雨',
    57: '冻毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    66: '冻雨',
    67: '冻雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    77: '米雪',
    80: '阵雨',
    81: '强阵雨',
    82: '暴雨',
    85: '阵雪',
    86: '强阵雪',
    95: '雷阵雨',
    96: '雷阵雨伴冰雹',
    99: '强雷暴伴冰雹',
  };
  return map[code] ?? '未知';
}

/** 风向度数 → 中文方位 */
function windDirText(deg?: number): string | undefined {
  if (deg === undefined || Number.isNaN(deg)) return undefined;
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return `${dirs[Math.round((deg % 360) / 45) % 8]}风`;
}

/** Open-Meteo 天气：实况 + 多天预报 + 空气质量（免费无 Key） */
async function fetchWeatherFree(place: PlaceInfo, loc: GeoLocation): Promise<WeatherReport> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant` +
    `&timezone=auto&forecast_days=4`;
  const data = await fetchJson(url);
  if (!data?.current || !data?.daily) throw new Error('Open-Meteo 天气接口返回异常');

  const cur = data.current;
  const daily = data.daily;
  const days: ForecastDay[] = (daily.time as string[]).map((iso, i) => {
    const { date, weekday } = formatDay(iso);
    return {
      date,
      weekday,
      textDay: wmoText(daily.weather_code?.[i]),
      tempMax: Math.round(daily.temperature_2m_max?.[i]),
      tempMin: Math.round(daily.temperature_2m_min?.[i]),
      windDir: windDirText(daily.wind_direction_10m_dominant?.[i]),
      windScale: daily.wind_speed_10m_max?.[i] !== undefined ? `${Math.round(daily.wind_speed_10m_max[i])}km/h` : undefined,
    };
  });

  const today: ForecastDay = days[0] ?? {
    date: nowInBeijing().date,
    weekday: nowInBeijing().weekday,
    textDay: wmoText(cur.weather_code),
    tempMax: Math.round(cur.temperature_2m),
    tempMin: Math.round(cur.temperature_2m),
  };

  // 空气质量（可选，失败不影响主流程）
  let aqi: number | undefined;
  let aqiCategory: string | undefined;
  try {
    const aq = await fetchJson(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.latitude}&longitude=${loc.longitude}&current=us_aqi`,
    );
    if (aq?.current?.us_aqi !== undefined) {
      aqi = Math.round(aq.current.us_aqi);
      aqiCategory = aqiLevel(aqi);
    }
  } catch {
    // 忽略空气质量失败
  }

  const current = {
    text: wmoText(cur.weather_code),
    temperature: Math.round(cur.temperature_2m),
    feelsLike: cur.apparent_temperature !== undefined ? Math.round(cur.apparent_temperature) : undefined,
    humidity: cur.relative_humidity_2m,
    windDir: windDirText(cur.wind_direction_10m),
    windScale: cur.wind_speed_10m !== undefined ? `${Math.round(cur.wind_speed_10m)}km/h` : undefined,
    aqi,
    aqiCategory,
    reportTime: formatTime(cur.time),
  };

  return {
    place,
    current,
    forecast: days,
    tips: buildTips(current, today),
    source: 'Open-Meteo',
  };
}

/** 美国 AQI 等级 */
function aqiLevel(aqi: number): string {
  if (aqi <= 50) return '优';
  if (aqi <= 100) return '良';
  if (aqi <= 150) return '轻度污染';
  if (aqi <= 200) return '中度污染';
  if (aqi <= 300) return '重度污染';
  return '严重污染';
}

// ==================== 对外统一入口 ====================

/**
 * 解析地点：
 * - 传了 city（用户明确指定城市）→ 地理编码
 * - 没传 city 但传了 location（用户当前位置）→ 逆地理编码
 */
async function resolvePlace(input: {
  city?: string;
  location?: GeoLocation;
}): Promise<{ place: PlaceInfo; location?: GeoLocation } | null> {
  const useAmap = Boolean(config.amapKey);
  const city = input.city?.trim();

  if (city) {
    if (useAmap) {
      const place = await geocodeAmap(city).catch(() => null);
      if (place) return { place, location: undefined };
    }
    const free = await geocodeFree(city).catch(() => null);
    if (free) return { place: free.place, location: free.location };
    return null;
  }

  if (input.location) {
    const place = useAmap
      ? await reverseGeocodeAmap(input.location).catch(() => null)
      : await reverseGeocodeFree(input.location).catch(() => null);
    if (place) return { place, location: input.location };
    // 逆地理失败时，仍可用坐标查天气，地名退化为「当前位置」
    return {
      place: { city: '当前位置', displayName: '当前位置' },
      location: input.location,
    };
  }

  return null;
}

/**
 * 查询天气（对上层唯一入口）
 * @param input.city     用户指定的城市名（可选）
 * @param input.location 用户当前位置坐标（可选，city 为空时使用）
 */
export async function getWeatherReport(input: {
  city?: string;
  location?: GeoLocation;
}): Promise<WeatherReport> {
  const resolved = await resolvePlace(input);
  if (!resolved) {
    throw new Error('无法确定要查询的位置：请提供城市名，或授权获取当前位置');
  }

  const useAmap = Boolean(config.amapKey);
  if (useAmap) {
    return fetchWeatherAmap(resolved.place);
  }

  if (!resolved.location) {
    throw new Error('缺少位置坐标：请在 .env 配置 AMAP_KEY，或提供可定位的城市名');
  }
  return fetchWeatherFree(resolved.place, resolved.location);
}
