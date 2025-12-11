import React from 'react';
import Link from 'next/link';

const WidgetShopAds = () => {
    return (
        <aside className="widget widget_ads">
            <Link href={'/shop'}>
                <img src="/static/img/ads/product-ads.png" alt="martfury" />
            </Link>
        </aside>
    );
};

export default WidgetShopAds;
