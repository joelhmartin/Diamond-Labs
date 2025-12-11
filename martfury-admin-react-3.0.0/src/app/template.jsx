'use client';
import React, { useEffect } from 'react';
import Providers from '~/redux/provider';
import '~/public/fonts/Linearicons/Font/demo-files/demo.css';
import '~/public/fonts/font-awesome/css/font-awesome.css';
import 'public/css/bootstrap.min.css';
import '~/styles/style.scss';

export const metadata = {
    title: 'Martfury - Multipurpose Marketplace React Ecommerce Template',
    description: '',
}

export default function Template({ children }) {
    useEffect(() => {
        setTimeout(function() {
            document.getElementById('__next').classList.add('loaded');
        }, 100);
    }, []);

    return (
        <Providers>
            {children}
        </Providers>
    );
}

