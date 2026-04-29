import PhoneMockup from './PhoneMockup';

const avatars = [
  'bg-violet-400',
  'bg-purple-500',
  'bg-indigo-400',
];

export default function Hero() {
  return (
    <section className="relative min-h-[calc(100vh-72px)] bg-white overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-0 right-0 w-[650px] h-[650px] rounded-full bg-gradient-to-br from-violet-100 via-purple-50 to-indigo-100 -translate-y-1/4 translate-x-1/4 opacity-70" />
      <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-violet-50 translate-y-1/2 -translate-x-1/4" />

      <div className="relative max-w-7xl mx-auto px-6 py-16 flex flex-col lg:flex-row items-center justify-between gap-12">
        {/* Left content */}
        <div className="flex-1 max-w-xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold px-4 py-2 rounded-full mb-8">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            YOUR HEALTH. YOUR SCHEDULE.
          </div>

          {/* Headline */}
          <h1 className="text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            <span className="text-gray-900">Better care,</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 to-purple-600">
              better life.
            </span>
          </h1>

          {/* Subtext */}
          <p className="text-gray-500 text-lg leading-relaxed mb-10">
            Expert healthcare consultations, on your schedule.<br />
            Book in minutes. Feel better always.
          </p>

          {/* App store buttons */}
          <div className="flex flex-wrap gap-4 mb-10">
            <button className="flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-xl hover:bg-gray-800 transition-colors shadow-lg">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              <div className="text-left">
                <p className="text-[10px] leading-none text-gray-300">Download on the</p>
                <p className="text-sm font-semibold leading-tight">App Store</p>
              </div>
            </button>

            <button className="flex items-center gap-3 bg-white border-2 border-gray-200 text-gray-900 px-5 py-3 rounded-xl hover:border-violet-300 transition-colors shadow-sm">
              <svg width="22" height="22" viewBox="0 0 24 24">
                <path d="M3.18 23.76c.3.17.64.24.99.19l13.2-7.62-2.88-2.89-11.31 10.32z" fill="#EA4335"/>
                <path d="M22.34 10.24c-.42-.44-1.08-.68-1.98-.68H3.64c-.9 0-1.57.24-1.98.68L12 17.69l10.34-7.45z" fill="#FBBC04"/>
                <path d="M2.19.24C1.78.68 1.56 1.35 1.56 2.25v19.5c0 .9.22 1.57.63 2.01l.13.12 10.92-10.92v-.26L2.32.12l-.13.12z" fill="#4285F4"/>
                <path d="M21.82.12L12 9.76v.26l10.92 10.92c.4-.44.63-1.11.63-2.01V2.25c0-.9-.22-1.57-.63-2.01l-.1-.12z" fill="#34A853"/>
              </svg>
              <div className="text-left">
                <p className="text-[10px] leading-none text-gray-400">GET IT ON</p>
                <p className="text-sm font-semibold leading-tight">Google Play</p>
              </div>
            </button>
          </div>

          {/* Social proof */}
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2">
              {avatars.map((color, i) => (
                <div
                  key={i}
                  className={`w-9 h-9 rounded-full ${color} border-2 border-white flex items-center justify-center text-white text-xs font-bold shadow-sm`}
                >
                  {['S', 'J', 'M'][i]}
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center gap-1 mb-0.5">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                ))}
              </div>
              <p className="text-sm text-gray-500">4.9/5 from <span className="font-semibold text-gray-700">5,000+</span> happy patients</p>
            </div>
          </div>
        </div>

        {/* Right — phone mockup */}
        <div className="relative flex-1 flex justify-center items-center">
          {/* Sparkle decorations */}
          <div className="absolute top-8 left-8 text-violet-300 text-3xl select-none">✦</div>
          <div className="absolute top-24 right-4 text-purple-200 text-xl select-none">✦</div>
          <div className="absolute bottom-16 left-4 text-indigo-200 text-2xl select-none">✦</div>

          {/* Floating card top-left */}
          <div className="absolute -left-4 top-24 bg-white rounded-2xl shadow-xl p-3 flex items-center gap-2 z-10 border border-violet-50">
            <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center text-green-600 text-sm">✓</div>
            <div>
              <p className="text-[10px] font-bold text-gray-800">Appointment confirmed</p>
              <p className="text-[9px] text-gray-400">Dr. Sarah • Today 3PM</p>
            </div>
          </div>

          {/* Floating card bottom-right */}
          <div className="absolute -right-2 bottom-28 bg-white rounded-2xl shadow-xl p-3 z-10 border border-violet-50">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-6 h-6 bg-violet-100 rounded-lg flex items-center justify-center text-violet-600 text-xs">🩺</div>
              <p className="text-[10px] font-bold text-gray-800">Live consultation</p>
            </div>
            <div className="flex gap-1">
              <div className="h-1.5 flex-1 bg-violet-500 rounded-full"/>
              <div className="h-1.5 flex-1 bg-violet-300 rounded-full"/>
              <div className="h-1.5 flex-1 bg-violet-200 rounded-full"/>
            </div>
          </div>

          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}
