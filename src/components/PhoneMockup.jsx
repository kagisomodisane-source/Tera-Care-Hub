export default function PhoneMockup() {
  return (
    <div className="relative w-[280px] h-[560px] mx-auto">
      {/* Phone shell */}
      <div className="absolute inset-0 bg-gray-900 rounded-[44px] shadow-2xl shadow-violet-300/50 overflow-hidden border-4 border-gray-800">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-7 bg-gray-900 rounded-b-2xl z-10" />

        {/* Screen content */}
        <div className="absolute inset-0 bg-white overflow-hidden rounded-[40px]">
          {/* Status bar */}
          <div className="flex justify-between items-center px-6 pt-3 pb-1 text-xs font-semibold text-gray-800">
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
                <rect x="0" y="4" width="3" height="7" rx="1" fill="#1a1a2e"/>
                <rect x="4" y="2.5" width="3" height="8.5" rx="1" fill="#1a1a2e"/>
                <rect x="8" y="1" width="3" height="10" rx="1" fill="#1a1a2e"/>
                <rect x="12" y="0" width="3" height="11" rx="1" fill="#1a1a2e"/>
              </svg>
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                <path d="M8 2.5C10.21 2.5 12.21 3.38 13.67 4.83L15 3.5C13.18 1.73 10.72 0.67 8 0.67C5.28 0.67 2.82 1.73 1 3.5L2.33 4.83C3.79 3.38 5.79 2.5 8 2.5Z" fill="#1a1a2e"/>
                <path d="M8 5.17C9.47 5.17 10.79 5.76 11.74 6.74L13.07 5.41C11.75 4.12 9.97 3.33 8 3.33C6.03 3.33 4.25 4.12 2.93 5.41L4.26 6.74C5.21 5.76 6.53 5.17 8 5.17Z" fill="#1a1a2e"/>
                <circle cx="8" cy="9.5" r="2" fill="#1a1a2e"/>
              </svg>
              <div className="flex items-center gap-0.5">
                <div className="w-5 h-2.5 rounded-sm border border-gray-800 flex items-center px-0.5">
                  <div className="w-3 h-1.5 bg-gray-800 rounded-sm"/>
                </div>
              </div>
            </div>
          </div>

          {/* App header */}
          <div className="px-5 pt-2 pb-3 flex justify-between items-center">
            <div>
              <p className="text-xs text-gray-500">Welcome back,</p>
              <p className="text-base font-bold text-gray-900">Alex 👋</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold shadow-md">
              A
            </div>
          </div>

          {/* Next appointment card */}
          <div className="mx-4 bg-gradient-to-r from-violet-500 to-purple-600 rounded-2xl p-3.5 flex justify-between items-center shadow-lg">
            <div>
              <p className="text-violet-100 text-[10px] font-medium">Your next appointment</p>
              <p className="text-white font-bold text-sm mt-0.5">Tomorrow, 10:00 AM</p>
              <p className="text-violet-200 text-[10px] mt-0.5">Dr. Johnson • 30 min</p>
            </div>
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="18" rx="3" stroke="white" strokeWidth="2"/>
                <path d="M3 9h18" stroke="white" strokeWidth="2"/>
                <path d="M8 2v4M16 2v4" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
          </div>

          {/* Popular Services */}
          <div className="px-4 mt-4">
            <div className="flex justify-between items-center mb-2.5">
              <p className="text-sm font-bold text-gray-900">Our Services</p>
              <p className="text-[10px] text-violet-600 font-semibold">See all</p>
            </div>
            <div className="flex gap-2">
              {[
                { label: 'General\nConsult', icon: '🩺' },
                { label: 'Mental\nHealth', icon: '🧠' },
                { label: 'Specialist\nCare', icon: '⚕️' },
              ].map((s) => (
                <div key={s.label} className="flex-1 bg-violet-50 rounded-xl p-2.5 flex flex-col items-center gap-1">
                  <span className="text-lg">{s.icon}</span>
                  <p className="text-[9px] font-semibold text-gray-700 text-center leading-tight whitespace-pre-line">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Book button */}
          <div className="px-4 mt-3.5">
            <button className="w-full bg-gradient-to-r from-violet-500 to-purple-600 text-white text-xs font-bold py-2.5 rounded-xl shadow-md">
              Book a Consultation
            </button>
          </div>

          {/* Why Tera Care */}
          <div className="px-4 mt-3.5">
            <p className="text-xs font-bold text-gray-900 mb-2">Why Tera Care Hub?</p>
            {[
              'Verified & licensed doctors',
              '100% confidential sessions',
              'Easy booking & secure payments',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 mb-1.5">
                <div className="w-3.5 h-3.5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="text-[10px] text-gray-600">{item}</p>
              </div>
            ))}
          </div>

          {/* Bottom nav */}
          <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex justify-around py-2 px-2">
            {[
              { icon: '🏠', label: 'Home', active: true },
              { icon: '📅', label: 'Bookings', active: false },
              { icon: '💬', label: 'Messages', active: false },
              { icon: '👤', label: 'Profile', active: false },
            ].map((item) => (
              <button key={item.label} className="flex flex-col items-center gap-0.5">
                <span className="text-sm">{item.icon}</span>
                <span className={`text-[8px] font-semibold ${item.active ? 'text-violet-600' : 'text-gray-400'}`}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
