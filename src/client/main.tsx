import { bootstrapApp } from "./bootstrap";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

void bootstrapApp(rootElement);
