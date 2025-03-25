# DiskSense

DiskSense is a modern disk space analyzer that helps you visualize and manage storage space on your computer. Built with Tauri, React, and Next.js, it provides an interactive treemap visualization of your directory structure, making it easy to identify large files and folders consuming valuable disk space.

## Features

- **Interactive Treemap Visualization**: Easily navigate through your directory structure with a color-coded treemap interface
- **Fast & Comprehensive Scan Modes**: Choose between quick estimation or detailed analysis of directory sizes
- **Progress Tracking**: Real-time progress updates during directory scanning
- **File Management**: Built-in context menu for common file operations (open, delete, view properties)
- **Customizable Scanning**:
  - Adjustable scan depth (1-4 levels)
  - Option to skip hidden files
  - Choice between fast and comprehensive scanning modes
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Getting Started

### Prerequisites

- Node.js (v16 or later)
- Rust (latest stable version)
- Tauri CLI

### Installation

1. Clone the repository:

```bash
git clone https://github.com/ScriptedButton/disksense.git
cd disksense
```

2. Install dependencies:

```bash
npm install
# or
yarn install
```

3. Run the development version:

```bash
npm run tauri dev
# or
yarn tauri dev
```

### Building

To create a production build:

```bash
npm run tauri build
# or
yarn tauri build
```

The built application will be available in the `src-tauri/target/release` directory.

## Usage

1. Launch DiskSense
2. Select a directory to analyze
3. Use the interactive treemap to explore your disk usage:
   - Click on directories to navigate deeper
   - Right-click for file/folder operations
   - Use the back button to navigate up
   - Adjust scan settings as needed

## Performance Tips

- Use "Fast" scan mode for quick directory size estimation
- Skip hidden files to speed up scanning
- Reduce scan depth for faster results in large directories
- Use "Comprehensive" scan mode only when accurate file sizes are needed

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT License](LICENSE)
