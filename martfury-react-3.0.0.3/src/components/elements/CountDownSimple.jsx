import React, { useEffect, useState } from 'react';

import moment from 'moment';

const CountDownSimple = ({ timeTillDate, timeFormat }) => {
    const [timeLeft, setTimeLeft] = useState({
        seconds: null,
        minutes: null,
        hours: null,
        days: null,
    });

    useEffect(() => {
        const updateCountdown = () => {
            const then = moment(timeTillDate, timeFormat);
            const now = moment();
            const countdown = moment.duration(then.diff(now));
            const days = countdown.days();
            const hours = countdown.hours();
            const minutes = countdown.minutes();
            const seconds = countdown.seconds();

            setTimeLeft({ days, hours, minutes, seconds });
        };

        updateCountdown(); // For immediate update on mount
        const interval = setInterval(updateCountdown, 1000);

        return () => clearInterval(interval); // Cleanup on unmount
    }, [timeTillDate, timeFormat]); // Only re-run effect if these props change

    const { days, hours, minutes, seconds } = timeLeft;

    return (
        <ul className="ps-countdown">
            <li>
                <span className="days mr-1">{days}</span>
            </li>
            <li>
                <span className="hours ml-1 mr-1">{hours}</span>
            </li>
            <li>
                <span className="minutes ml-1 mr-1">{minutes}</span>
            </li>
            <li>
                <span className="seconds ml-1">{seconds}</span>
            </li>
        </ul>
    );
};

export default CountDownSimple;
