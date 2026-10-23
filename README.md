# Stow

**Put it away. Find it later.** Stow is a phone-first home memory. Take a photo of an item, write a short note about where it went, then find it later with a natural-language question.

This project is being built for the Hacktoberfest 2026 Week 3 challenge, **Slow and Steady**. The first demo is a responsive web app that opens the phone camera. The phone sends the image and note over the home Wi-Fi to the user's own computer, where the local model and SQLite database run. There is no hosted AI API.

## Stack

- React, Vite, and TypeScript for the phone-first interface
- FastAPI and SQLite for the local API and saved memories
- Ollama with Gemma 3 4B for image-aware memory extraction and natural-language lookup
- Optional photo storage on the local computer; no cloud storage

## Run locally

This prototype runs on a computer with Node.js, Python, and Ollama installed. The phone is a camera and browser client; the computer stays on to provide the local app, model, and database. It is not yet packaged as a one-click consumer install.

1. Install [Ollama](https://ollama.com/download) and download the model: `ollama pull gemma3:4b`.
2. Install the API dependencies: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.
3. Start the API from the project root: `uvicorn backend.main:app --host 127.0.0.1 --port 8000`.
4. In another terminal, install and start the web app: `npm install && npm run dev`.
5. On the same Wi-Fi, open the Vite network URL on your phone. Use the camera button to take a photo and add a sentence such as “I put the spare charger in the blue desk drawer.”

The photo and note travel only over the local network to the computer running this app. The model uses the note to identify the item and location; it may use the photo to help name the item, but never to guess where it is. The API validates that a search result refers to a saved record, then returns the original stored location.

## Current MVP boundary

- Save a memory from a short natural-language note, with an optional phone photo
- Find it later using a natural-language question
- Keep text and optional photos in local SQLite/files
- Delete saved memories

Voice recording is a follow-up after the photo-and-search flow works. The first version accepts typed notes; browser speech recognition is intentionally avoided because it may use a remote transcription service.

## Notes

- The computer running Ollama must remain on and on the same Wi-Fi as the phone.
- The Vite dev server is exposed to the local network for this demo. Do not forward its ports to the public internet.
- Hosting Stow publicly would move notes and photos off the user's computer and change the privacy model. The current prototype is designed for a trusted home network.
- Gemma's location extraction and search are suggestions. Check the saved location before relying on it.
