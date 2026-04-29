export default function Navbar() {
  return (
    <nav className="w-full bg-white/80 backdrop-blur-md border-b border-violet-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="white" opacity="0.3"/>
              <path d="M12 4c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 10c-2.7 0-5.8 1.29-6 2h12c-.2-.71-3.3-2-6-2z" fill="white" opacity="0.5"/>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="white"/>
            </svg>
          </div>
          <span className="text-xl font-bold">
            <span className="text-gray-900">Tera</span>
            <span className="text-violet-600"> Care Hub</span>
          </span>
        </div>

        {/* Nav Links */}
        <div className="hidden md:flex items-center gap-8">
          {['Home', 'How It Works', 'Services', 'Pricing', 'About Us', 'Help'].map((link) => (
            <a
              key={link}
              href="#"
              className="text-gray-600 hover:text-violet-600 font-medium text-sm transition-colors duration-200"
            >
              {link}
            </a>
          ))}
        </div>

        {/* CTA Button */}
        <button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white px-6 py-2.5 rounded-full font-semibold text-sm shadow-lg shadow-violet-200 hover:shadow-violet-300 hover:scale-105 transition-all duration-200">
          Book Now
        </button>
      </div>
    </nav>
  );
}
