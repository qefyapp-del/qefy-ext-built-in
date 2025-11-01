⚠️This project is not 100% ready for public use, and it is open for participation in the Chrome challenge.

# qefy-ext-built-in
Queuefy is a smart bookmarking app for video and audio content, letting users save, organize, and play YouTube videos, podcasts, and more in seamless playlists. With a browser extension and mobile app, Queuefy makes it easy to queue up content from multiple platforms and enjoy it distraction-free, anytime.

With a focus on design and user experience, our goal is to create a beautiful UI with easy-to-access tools.

Accessibility is one of our focuses; we want the user to navigate using shortcuts, directional pads, voice commands, or widgets.

The focus is to make the experience as fluid as possible, which is why we will have a sync engine that will even work offline.

## The chrome extension
I'm participating in the Google challenge, and therefore I'm sharing the Chrome extension repository here.
https://googlechromeai2025.devpost.com/

## Instructions
- Install the exntension mannualy accessing chrome://extensions/ and "Load Unpacked"
- activate the ai flag and have the model downloaded in Chrome.
- After that login with

## Inspiration
I'm working on my first project as an indie developer for publication. I was almost finished, but I discovered the challenge of Chrome's built-in and decided to add AI features to my project.

## What it does
qefy allows you to save and organize media links from various platforms, and with the help of the extension, it features platform-agnostic autoplay - although it's only well-tested on YouTube so far - and now with the help of AI and some action buttons I added from the YouTube homepage, you have much more ease in sorting a video according to its folders. The AI reads and interprets the thumbnail, title, duration, etc., and finds the best place to add the new video.

So I have 3 AI features on the app:
- Let AI decide for me (button on youtube, AI will choose one playlist for you)
- Clean my tabs (get all your youtube tabs and suggest one folder, save on qefy and clean your tabs)
- Custom playlist (the user can request to create a new playlist with the videos saved on qefy) 

## How we built it
The web app was built with flutter
The extension - open source - built with js

## Challenges we ran into
Running a local model presents some challenges due to it being a mini model, but with some prompt optimization techniques I achieved a good result.

## Accomplishments that we're proud of
I have AI integrated into my app, for free, I wasn't expecting that haha.

## What we learned
How to develop a Chrome extension and how to use Chrome's built-in AI APIs.

## What's next for QEFY
Publish my project and build it in public.
Keep adding more feature. 
