import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  
  // Turbopack configuration (Next.js 16+)
  turbopack: {
    resolveAlias: {
      // Handle mediainfo.js WASM - redirect to public folder
      // 'MediaInfoModule.wasm': './public/assets/MediaInfoModule.wasm',
    },
  },
  
  // Webpack fallback for production builds
  webpack: (config, { isServer }) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules', '**/OpenCut/**', '../OpenCut/**'],
    };
    
    // Handle WASM files
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    
    // Add rule for WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    
    return config;
  },
  
  // Enable experimental features for workers
  experimental: {
    // Allow importing workers
  },
};

export default nextConfig;
