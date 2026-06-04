import { useEffect, useState, useCallback } from 'react';
import AxiosCustom from '../axios/AxiosCustom';
import { useT } from '../i18n/LanguageContext';

const WEATHER_ICONS = {
  '01d': '☀️', '01n': '🌙',
  '02d': '⛅', '02n': '⛅',
  '03d': '☁️', '03n': '☁️',
  '04d': '☁️', '04n': '☁️',
  '09d': '🌧️', '09n': '🌧️',
  '10d': '🌦️', '10n': '🌧️',
  '11d': '⛈️', '11n': '⛈️',
  '13d': '❄️', '13n': '❄️',
  '50d': '🌫️', '50n': '🌫️',
};

export default function WeatherWidget({ lat = 37.5665, lon = 126.9780, city }) {
  const t = useT('settings');
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchWeather = useCallback(() => {
    const params = city
      ? `?city=${encodeURIComponent(city)}`
      : `?lat=${lat}&lon=${lon}`;
    AxiosCustom.get(`/api/weather${params}`)
      .then(r => {
        const d = r.data;
        setWeather(d && typeof d.temp === 'number' && !d.error ? d : null);
      })
      .catch(() => setWeather(null))
      .finally(() => setLoading(false));
  }, [lat, lon, city]);

  useEffect(() => {
    fetchWeather();
    const timer = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchWeather]);

  const icon = weather ? (WEATHER_ICONS[weather.icon] || '🌤️') : '—';

  return (
    <div style={{
      background: '#0a1525', border: '1px solid #253347',
      borderRadius: 12, padding: '14px 18px',
    }}>
      <p style={{ fontSize: 11, color: '#4b5563', marginBottom: 8, fontWeight: 600 }}>
        {t('weatherWidgetTitle')}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 32, lineHeight: 1 }}>{loading ? '…' : icon}</span>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#e2e8f0' }}>
              {weather ? `${Number(weather.temp).toFixed(1)}°C` : '—'}
            </span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {weather?.cityName || t('weatherSite')}
            </span>
            {weather?.mock && (
              <span style={{
                fontSize: 10, color: '#d97706', background: '#1a1000',
                border: '1px solid #d97706', borderRadius: 4, padding: '1px 5px',
              }}>DEMO</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#8896a4', marginTop: 2 }}>
            {weather?.description || '—'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b7280' }}>
          {weather && (
            <>
              <span>{t('weatherHumidity', { v: weather.humidity })}</span>
              <span>{t('weatherWind', { v: Number(weather.windSpeed).toFixed(1) })}</span>
              <span>{t('weatherFeels', { v: Number(weather.feelsLike).toFixed(0) })}</span>
            </>
          )}
        </div>
      </div>

      {weather && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 10,
          paddingTop: 10, borderTop: '1px solid #1a2a3a',
          fontSize: 11, color: '#4b5563',
        }}>
          <span>{t('weatherLow', { v: Number(weather.tempMin).toFixed(0) })}</span>
          <span>{t('weatherHigh', { v: Number(weather.tempMax).toFixed(0) })}</span>
          <span style={{ marginLeft: 'auto' }}>{t('weatherAutoRefresh')}</span>
        </div>
      )}
    </div>
  );
}
