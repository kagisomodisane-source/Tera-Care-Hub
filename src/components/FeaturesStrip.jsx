const features = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="18" rx="3" stroke="#7c3aed" strokeWidth="2"/>
        <path d="M3 9h18" stroke="#7c3aed" strokeWidth="2"/>
        <path d="M8 2v4M16 2v4" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round"/>
        <path d="M8 13h8M8 16h5" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    bg: 'bg-violet-100',
    title: 'Easy Booking',
    desc: 'Schedule your consultation in just a few taps.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="#0d9488"/>
      </svg>
    ),
    bg: 'bg-teal-100',
    title: 'Verified Doctors',
    desc: 'Licensed & background-checked professionals.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7l-9-5z" stroke="#7c3aed" strokeWidth="2" fill="none"/>
        <path d="M9 12l2 2 4-4" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    bg: 'bg-violet-100',
    title: 'Quality Guarantee',
    desc: 'Not satisfied? We\'ll make it right.',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="6" width="18" height="14" rx="3" stroke="#0d9488" strokeWidth="2"/>
        <path d="M3 10h18" stroke="#0d9488" strokeWidth="2"/>
        <circle cx="7.5" cy="15" r="1.5" fill="#0d9488"/>
        <path d="M11 15h6" stroke="#0d9488" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    bg: 'bg-teal-100',
    title: 'Secure Payments',
    desc: 'Safe, encrypted & hassle-free.',
  },
];

export default function FeaturesStrip() {
  return (
    <section className="bg-white border-t border-violet-100">
      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 lg:grid-cols-4 gap-8">
        {features.map((f) => (
          <div key={f.title} className="flex items-start gap-4">
            <div className={`w-14 h-14 ${f.bg} rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm`}>
              {f.icon}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 mb-1">{f.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
