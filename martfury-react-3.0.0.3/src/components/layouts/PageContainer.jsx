'use client';
import React from 'react';
import HeaderDefault from '~/components/shared/headers/HeaderDefault';
import FooterFullwidth from '~/components/shared/footers/FooterFullwidth';
import HeaderMobile from '~/components/shared/headers/HeaderMobile';

const initHeaders = (
    <>
        <HeaderDefault />
        <HeaderMobile />
    </>
);
const initFooters = <FooterFullwidth />;

const PageContainer = ({
    header = initHeaders,
    footer = initFooters,
    children,
}) => {
    return (
        <>
            {header}
            {children}
            {footer}
        </>
    );
};

export default PageContainer;
