FROM ghcr.io/engineer-man/piston:latest

# Railway containers do not allow writing to /sys/fs/cgroup, so strip cgroup flags.
RUN sed -i "s/--cg//g" /piston_api/src/job.js

ENV PISTON_DATA_DIRECTORY=/tmp/piston

COPY install-required-packages.js /opt/piston/install-required-packages.js
COPY start-piston.sh /opt/piston/start-piston.sh
RUN chmod +x /opt/piston/start-piston.sh

EXPOSE 2000

CMD ["/opt/piston/start-piston.sh"]
