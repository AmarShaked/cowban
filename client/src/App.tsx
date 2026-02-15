import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Board } from "./components/Board";
import { Settings } from "./components/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Board />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
