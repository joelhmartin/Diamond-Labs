export const SITE_URL = 'localhost';
export const SITE_NAME = 'Martfury ';
export const AUTHOR = 'Nouthemes';
export const CREATOR_ID = 'Nouthemes';

const mainHeadData = {
    '/': {
        title: 'Martfury - React Ecommerce Template',
        desc: "Elevate your online store with Martfury React Template. Customizable, SEO-friendly, and user-centric design. Secure payments, intuitive navigation. Unleash your store's potential.",
        canonical: SITE_URL,
        isIndexed: true,
        followLinks: true,
        lastmod: '2024-01-01',
        priority: 0.2,
    },
};

export default function getHeadData(path) {
    const content = mainHeadData[path];

    if (content === undefined) {
        const defaultData = mainHeadData['UNDEFINED'];
        if (!defaultData)
            throw new Error(
                'CRITICAL ERROR: No default data exists on RoutePathsSEO'
            );
        return defaultData;
    } else {
        return content;
    }
}

export const generatePageMetadata = (seoData) => ({
    title: seoData.title,
    description: seoData.desc,
    metadataBase: 'http://localhost:3000',
    generator: AUTHOR,
    applicationName: SITE_NAME,
    referrer: 'origin-when-cross-origin',
    keywords: [''],
    authors: [{ name: AUTHOR }, { name: AUTHOR, url: SITE_URL }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    /*formatDetection: {
        email: false,
        address: false,
        telephone: false,
    },*/
    robots: {
        index: seoData.isIndexed,
        follow: seoData.followLinks,
        nocache: true,
        googleBot: {
            index: seoData.isIndexed,
            follow: seoData.followLinks,
            noimageindex: true,
            'max-video-preview': -1,
            'max-image-preview': 'large',
            'max-snippet': -1,
        },
    },
    alternates: {
        canonical: seoData.canonical,
    },

    twitter: {
        card: 'summary_large_image',
        title: seoData.title,
        description: seoData.desc,
        creator: AUTHOR,
        creatorId: CREATOR_ID,
        siteId: '',
        images: [process.env.PUBLIC_ASSET_PREFIX + '/images/preview.jpeg'],
    },

    openGraph: {
        title: seoData.title,
        description: seoData.desc,
        url: SITE_URL,
        siteName: SITE_NAME,
        images: [
            {
                url: process.env.PUBLIC_ASSET_PREFIX + '/images/preview.jpeg',
                width: 1200,
                height: 628,
                alt: SITE_NAME,
            },
        ],
        type: 'website',
    },
});

export function getIndexedPaths() {
    let res = [];
    Object.keys(mainHeadData).forEach((key) => {
        if (mainHeadData[key].isIndexed) res.push(mainHeadData[key]);
    });
    return res;
}
