import Navbar from './components/Navbar';
import Hero from './components/Hero';
import FeaturesStrip from './components/FeaturesStrip';
import './index.css';

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <Hero />
      <FeaturesStrip />
    </div>
  );
}
