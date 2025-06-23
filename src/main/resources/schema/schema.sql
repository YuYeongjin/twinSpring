CREATE TABLE sensor_data (
                             id IDENTITY PRIMARY KEY,
                             location VARCHAR(100) NOT NULL,
                             temperature INT NOT NULL,
                             timestamp VARCHAR(50) NOT NULL
);