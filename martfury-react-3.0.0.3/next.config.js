const nextSettings = {
    //transpilePackages: ['ahooks'],
    optimizeFonts: false,

    eslint: {
        ignoreDuringBuilds: true,
    },
    env: {
        title: 'Martfury',
        titleDescription: 'Multipurpose Marketplace React Ecommerce Template',
    },
    experimental: {
        missingSuspenseWithCSRBailout: false,
    },
    images: {
        remotePatterns: [
            {
                protocol: 'http', // http or https
                hostname: '127.0.0.1', // Next JS not allow use 'localhost', use '127.0.0.1 instead
                port: '1337', // empty string for no port
                pathname: '/uploads/**',
            },
        ],
    },
};

module.exports = nextSettings;
