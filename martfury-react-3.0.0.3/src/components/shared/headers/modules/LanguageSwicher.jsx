import React from 'react';
import { notification } from 'antd';

const LanguageSwitcher = () => {
    const handleFeatureWillUpdate = (e) => {
        e.preventDefault();
        notification.open({
            message: 'Opp! Something went wrong.',
            description: 'This feature has been updated later!',
            duration: 500,
        });
    };

    return (
        <div className="ps-dropdown language">
            <a href="#" onClick={handleFeatureWillUpdate}>
                <img src="/static/img/flag/en.png" alt="martfury" />
                English
            </a>
            <ul className="ps-dropdown-menu">
                <li>
                    <a href="#" onClick={handleFeatureWillUpdate}>
                        <img
                            src="/static/img/flag/germany.png"
                            alt="martfury"
                        />
                        Germany
                    </a>
                </li>
                <li>
                    <a href="#" onClick={handleFeatureWillUpdate}>
                        <img src="/static/img/flag/fr.png" alt="martfury" />
                        France
                    </a>
                </li>
            </ul>
        </div>
    );
};

export default LanguageSwitcher;
