'use client';
import React from 'react';
import BreadCrumb from '~/components/elements/BreadCrumb';
import PageContainer from '~/components/layouts/PageContainer';
import Newsletters from '~/components/partials/commons/Newletters';
import SearchContent from '~/components/partials/search/SearchContent';

const SearchPage = () => {
    const breadcrumb = [
        {
            text: 'Home',
            url: '/',
        },
        {
            text: 'Search Result',
        },
    ];

    return (
        <PageContainer title={`Search results`}>
            <div className="ps-page">
                <BreadCrumb breacrumb={breadcrumb} />
            </div>
            <div className="container">
                <SearchContent />
            </div>
            <Newsletters layout="container" />
        </PageContainer>
    );
};

export default SearchPage;
