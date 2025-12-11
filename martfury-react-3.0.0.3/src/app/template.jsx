'use client';
import React from 'react';
import Providers from '~/redux/provider';
import PageLoader from '~/components/elements/common/PageLoader';
import MobileNavigation from '~/components/shared/navigation/MobileNavigation';
import { BackTop } from 'antd';
import getHeadData, {
    generatePageMetadata,
} from '~/utilities/seo/RoutePathsSEO';

export const metadata = generatePageMetadata(getHeadData('/'));

export default function Template({ children }) {
    return (
        <Providers>
            {children}
            <PageLoader />
            <MobileNavigation />
            <BackTop>
                <button className="ps-btn--backtop">
                    <i className="icon-arrow-up" />
                </button>
            </BackTop>
        </Providers>
    );
}
