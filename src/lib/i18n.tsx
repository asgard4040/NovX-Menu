import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppLanguage = 'ar' | 'en';

const defaultCategoryNames: Record<string, string> = {
  'الوجبات الأساسية': 'Main dishes',
  'المقبلات': 'Appetizers',
  'الحلويات': 'Desserts',
  'المشروبات': 'Drinks',
};

const iraqiProvinceNames: Record<string, string> = {
  'بغداد': 'Baghdad', 'البصرة': 'Basra', 'نينوى': 'Nineveh', 'أربيل': 'Erbil',
  'النجف': 'Najaf', 'كربلاء': 'Karbala', 'ذي قار': 'Dhi Qar', 'بابل': 'Babil',
  'السليمانية': 'Sulaymaniyah', 'الأنبار': 'Anbar', 'ديالى': 'Diyala',
  'المثنى': 'Muthanna', 'كركوك': 'Kirkuk', 'صلاح الدين': 'Saladin',
  'واسط': 'Wasit', 'ميسان': 'Maysan', 'القادسية': 'Qadisiyah', 'دهوك': 'Duhok',
};

// Only built-in category labels are translated. Restaurant-authored content
// remains exactly as the owner entered it.
export function localizeCategory(category: string, language: AppLanguage): string {
  return language === 'en' ? defaultCategoryNames[category] || category : category;
}

export function localizeProvince(province: string, language: AppLanguage): string {
  return language === 'en' ? iraqiProvinceNames[province] || province : province;
}

const deviceTypeNames: Record<string, string> = {
  'جهاز أندرويد (Android)': 'Android device',
  'جهاز آيفون (iOS)': 'iPhone (iOS)',
  'كمبيوتر ماك (Mac OS)': 'Mac computer',
  'كمبيوتر ويندوز (Windows PC)': 'Windows computer',
  'جهاز لينكس (Linux PC)': 'Linux computer',
  'جهاز ذكي غير معروف': 'Unknown device',
};

export function localizeDeviceType(deviceType: string, language: AppLanguage): string {
  return language === 'en' ? deviceTypeNames[deviceType] || deviceType : deviceType;
}

type LanguageContextValue = {
  language: AppLanguage;
  dir: 'rtl' | 'ltr';
  isEnglish: boolean;
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
  tr: (arabic: string, english: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(() =>
    localStorage.getItem('novx_language') === 'en' ? 'en' : 'ar',
  );

  useEffect(() => {
    localStorage.setItem('novx_language', language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    dir: language === 'ar' ? 'rtl' : 'ltr',
    isEnglish: language === 'en',
    setLanguage,
    toggleLanguage: () => setLanguage((current) => current === 'ar' ? 'en' : 'ar'),
    tr: (arabic, english) => language === 'ar' ? arabic : english,
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
