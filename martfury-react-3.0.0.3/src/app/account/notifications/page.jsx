'use client';
import React from 'react';
import BreadCrumb from '~/components/elements/BreadCrumb';
import Notifications from '~/components/partials/account/Notifications';
import PageContainer from '~/components/layouts/PageContainer';
import FooterDefault from '~/components/shared/footers/FooterDefault';
import Newletters from '~/components/partials/commons/Newletters';

export default function Page() {
    const breadCrumb = [
        {
            text: 'Home',
            url: '/',
        },
        {
            text: 'Notifications',
        },
    ];
    return (
        <>
            <PageContainer footer={<FooterDefault />} title="Notifications">
                <div className="ps-page--my-account">
                    <BreadCrumb breacrumb={breadCrumb} />
                    <Notifications />
                </div>
                <Newletters layout="container" />
            </PageContainer>
        </>
    );
}
